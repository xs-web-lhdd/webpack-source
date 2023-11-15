/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

// enhanced-resolve封装库：多个插件之间的处理，使用doResolve()进行串联，涉及多种文件系统插件的路径查找，第一个插件找不到，就使用第二个插件，直到找到停止这种管道的查找
const Factory = require("enhanced-resolve").ResolverFactory;
const { HookMap, SyncHook, SyncWaterfallHook } = require("tapable");
const {
	cachedCleverMerge,
	removeOperations,
	resolveByProperty
} = require("./util/cleverMerge");

/** @typedef {import("enhanced-resolve").ResolveOptions} ResolveOptions */
/** @typedef {import("enhanced-resolve").Resolver} Resolver */
/** @typedef {import("../declarations/WebpackOptions").ResolveOptions} WebpackResolveOptions */
/** @typedef {import("../declarations/WebpackOptions").ResolvePluginInstance} ResolvePluginInstance */

/** @typedef {WebpackResolveOptions & {dependencyType?: string, resolveToContext?: boolean }} ResolveOptionsWithDependencyType */
/**
 * @typedef {Object} WithOptions
 * @property {function(Partial<ResolveOptionsWithDependencyType>): ResolverWithOptions} withOptions create a resolver with additional/different options
 */

/** @typedef {Resolver & WithOptions} ResolverWithOptions */

// need to be hoisted on module level for caching identity
const EMPTY_RESOLVE_OPTIONS = {};

/**
 * @param {ResolveOptionsWithDependencyType} resolveOptionsWithDepType enhanced options
 * @returns {ResolveOptions} merged options
 */
const convertToResolveOptions = resolveOptionsWithDepType => {
	const { dependencyType, plugins, ...remaining } = resolveOptionsWithDepType;

	// check type compat
	/** @type {Partial<ResolveOptions>} */
	const partialOptions = {
		...remaining,
		plugins:
			plugins &&
			/** @type {ResolvePluginInstance[]} */ (
				plugins.filter(item => item !== "...")
			)
	};

	if (!partialOptions.fileSystem) {
		throw new Error(
			"fileSystem is missing in resolveOptions, but it's required for enhanced-resolve"
		);
	}
	// These weird types validate that we checked all non-optional properties
	const options =
		/** @type {Partial<ResolveOptions> & Pick<ResolveOptions, "fileSystem">} */ (
			partialOptions
		);

	return removeOperations(
		resolveByProperty(options, "byDependency", dependencyType)
	);
};

/**
 * @typedef {Object} ResolverCache
 * @property {WeakMap<Object, ResolverWithOptions>} direct
 * @property {Map<string, ResolverWithOptions>} stringified
 */
/**
ResolverFactory 是 webpack 中用于创建 Resolver 实例的工厂类。核心逻辑由enhanced-resolve库来进行实现,
Resolver 用于将模块请求（如 require/import 声明）解析为文件路径或模块ID。
例如我们写了require('./index'),resolver就会用它来解析出./index的完整路径。
 */
module.exports = class ResolverFactory {
	constructor() {
		this.hooks = Object.freeze({
			/** @type {HookMap<SyncWaterfallHook<[ResolveOptionsWithDependencyType]>>} */
			resolveOptions: new HookMap(
				() => new SyncWaterfallHook(["resolveOptions"])
			),
			/** @type {HookMap<SyncHook<[Resolver, ResolveOptions, ResolveOptionsWithDependencyType]>>} */
			resolver: new HookMap(
				() => new SyncHook(["resolver", "resolveOptions", "userResolveOptions"])
			)
		});
		/** @type {Map<string, ResolverCache>} */
		this.cache = new Map();
	}

	/**
	 * @param {string} type type of resolver
	 * @param {ResolveOptionsWithDependencyType=} resolveOptions options
	 * @returns {ResolverWithOptions} the resolver
	 */
	get(type, resolveOptions = EMPTY_RESOLVE_OPTIONS) {
		let typedCaches = this.cache.get(type);
		if (!typedCaches) {
			typedCaches = {
				direct: new WeakMap(),
				stringified: new Map()
			};
			this.cache.set(type, typedCaches);
		}
		const cachedResolver = typedCaches.direct.get(resolveOptions);
		if (cachedResolver) {
			return cachedResolver;
		}
		const ident = JSON.stringify(resolveOptions);
		const resolver = typedCaches.stringified.get(ident);
		if (resolver) {
			typedCaches.direct.set(resolveOptions, resolver);
			return resolver;
		}
		 // 上面是 cache 处理
		const newResolver = this._create(type, resolveOptions);
		typedCaches.direct.set(resolveOptions, newResolver);
		typedCaches.stringified.set(ident, newResolver);
		return newResolver;
	}

	/**
	 * @param {string} type type of resolver
	 * @param {ResolveOptionsWithDependencyType} resolveOptionsWithDepType options
	 * @returns {ResolverWithOptions} the resolver
	 */
	_create(type, resolveOptionsWithDepType) {
		/** @type {ResolveOptionsWithDependencyType} */
		const originalResolveOptions = { ...resolveOptionsWithDepType };

		// 第1步：根据type获取不同的options配置
		const resolveOptions = convertToResolveOptions(
			// 会触发 WebpackOptionsApply.js 中注册的一系列解析器的钩子函数
			this.hooks.resolveOptions.for(type).call(resolveOptionsWithDepType)
		);
		 // 第2步：根据不同的配置创建不同的resolver
		const resolver = /** @type {ResolverWithOptions} */ (
			// 创建过程中会注册非常非常多的plugin，等待后续的resolver.resolve()调用来解析路径，要去enhanced-resolve的源码中看
			Factory.createResolver(resolveOptions)
		);
		if (!resolver) {
			throw new Error("No resolver created");
		}
		/** @type {WeakMap<Partial<ResolveOptionsWithDependencyType>, ResolverWithOptions>} */
		const childCache = new WeakMap();
		resolver.withOptions = options => {
			const cacheEntry = childCache.get(options);
			if (cacheEntry !== undefined) return cacheEntry;
			const mergedOptions = cachedCleverMerge(originalResolveOptions, options);
			const resolver = this.get(type, mergedOptions);
			childCache.set(options, resolver);
			return resolver;
		};
		this.hooks.resolver
			.for(type)
			.call(resolver, resolveOptions, originalResolveOptions);
		return resolver;
	}
};
