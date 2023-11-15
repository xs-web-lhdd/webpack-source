/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const util = require("util");
const { RawSource, ReplaceSource } = require("webpack-sources");
const Generator = require("../Generator");
const InitFragment = require("../InitFragment");
const HarmonyCompatibilityDependency = require("../dependencies/HarmonyCompatibilityDependency");

/** @typedef {import("webpack-sources").Source} Source */
/** @typedef {import("../DependenciesBlock")} DependenciesBlock */
/** @typedef {import("../Dependency")} Dependency */
/** @typedef {import("../DependencyTemplates")} DependencyTemplates */
/** @typedef {import("../Generator").GenerateContext} GenerateContext */
/** @typedef {import("../Module")} Module */
/** @typedef {import("../Module").ConcatenationBailoutReasonContext} ConcatenationBailoutReasonContext */
/** @typedef {import("../NormalModule")} NormalModule */
/** @typedef {import("../RuntimeTemplate")} RuntimeTemplate */

// TODO: clean up this file
// replace with newer constructs

const deprecatedGetInitFragments = util.deprecate(
	(template, dependency, templateContext) =>
		template.getInitFragments(dependency, templateContext),
	"DependencyTemplate.getInitFragment is deprecated (use apply(dep, source, { initFragments }) instead)",
	"DEP_WEBPACK_JAVASCRIPT_GENERATOR_GET_INIT_FRAGMENTS"
);

const TYPES = new Set(["javascript"]);

class JavascriptGenerator extends Generator {
	/**
	 * @param {NormalModule} module fresh module
	 * @returns {Set<string>} available types (do not mutate)
	 */
	getTypes(module) {
		return TYPES;
	}

	/**
	 * @param {NormalModule} module the module
	 * @param {string=} type source type
	 * @returns {number} estimate size of the module
	 */
	getSize(module, type) {
		const originalSource = module.originalSource();
		if (!originalSource) {
			return 39;
		}
		return originalSource.size();
	}

	/**
	 * @param {NormalModule} module module for which the bailout reason should be determined
	 * @param {ConcatenationBailoutReasonContext} context context
	 * @returns {string | undefined} reason why this module can't be concatenated, undefined when it can be concatenated
	 */
	getConcatenationBailoutReason(module, context) {
		// Only harmony modules are valid for optimization
		if (
			!module.buildMeta ||
			module.buildMeta.exportsType !== "namespace" ||
			module.presentationalDependencies === undefined ||
			!module.presentationalDependencies.some(
				d => d instanceof HarmonyCompatibilityDependency
			)
		) {
			return "Module is not an ECMAScript module";
		}

		// Some expressions are not compatible with module concatenation
		// because they may produce unexpected results. The plugin bails out
		// if some were detected upfront.
		if (module.buildInfo && module.buildInfo.moduleConcatenationBailout) {
			return `Module uses ${module.buildInfo.moduleConcatenationBailout}`;
		}
	}

	/**
	 * @param {NormalModule} module module for which the code should be generated
	 * @param {GenerateContext} generateContext context for generate
	 * @returns {Source} generated code
	 */
	generate(module, generateContext) {
		// 先取出 module 的原始代码内容，originalSource 其实就是返回 module._source
		const originalSource = module.originalSource();
		if (!originalSource) {
			return new RawSource("throw new Error('No source available');");
		}

		// 初始化源码 用的 webpack-source 这个库
		const source = new ReplaceSource(originalSource);
		const initFragments = [];

		// 进行依赖的遍历，不断执行对应的template.apply()，将结果放入到initFragments.push(fragment)中
		this.sourceModule(module, initFragments, source, generateContext);

		// 调用 InitFragment.addToSource 静态方法，将上一步操作产生的 source 对象与 initFragments 数组合并为模块产物
		// 调用 InitFragment.addToSource 合并 source 与 initFragments
		return InitFragment.addToSource(source, initFragments, generateContext);
	}

	/**
	 * @param {Module} module the module to generate
	 * @param {InitFragment[]} initFragments mutable list of init fragments
	 * @param {ReplaceSource} source the current replace source which can be modified
	 * @param {GenerateContext} generateContext the generateContext
	 * @returns {void}
	 */
	// 遍历module.dependencies和module.presentationalDependencies，然后调用sourceDependency()处理依赖文件的代码生成
	// 如果存在异步依赖的模块，则使用sourceBlock()处理，本质就是递归不断调用sourceDependency()处理依赖文件的代码生成
	sourceModule(module, initFragments, source, generateContext) {
		for (const dependency of module.dependencies) {
			// 执行每个数组项 dependency 对象的对应的 template.apply 方法，在 apply 内修改模块代码，或更新 initFragments 数组
			this.sourceDependency(
				module,
				dependency,
				initFragments,
				source,
				generateContext
			);
		}

		if (module.presentationalDependencies !== undefined) {
			for (const dependency of module.presentationalDependencies) {
				this.sourceDependency(
					module,
					dependency,
					initFragments,
					source,
					generateContext
				);
			}
		}

		// 处理异步依赖的模块
		for (const childBlock of module.blocks) {
			this.sourceBlock(
				module,
				childBlock,
				initFragments,
				source,
				generateContext
			);
		}
	}

	/**
	 * @param {Module} module the module to generate
	 * @param {DependenciesBlock} block the dependencies block which will be processed
	 * @param {InitFragment[]} initFragments mutable list of init fragments
	 * @param {ReplaceSource} source the current replace source which can be modified
	 * @param {GenerateContext} generateContext the generateContext
	 * @returns {void}
	 */
	// 处理异步依赖模块，本质上还是递归调用 sourceBlock 这两个方法
	sourceBlock(module, block, initFragments, source, generateContext) {
		for (const dependency of block.dependencies) {
			this.sourceDependency(
				module,
				dependency,
				initFragments,
				source,
				generateContext
			);
		}

		for (const childBlock of block.blocks) {
			this.sourceBlock(
				module,
				childBlock,
				initFragments,
				source,
				generateContext
			);
		}
	}

	/**
	 * @param {Module} module the current module
	 * @param {Dependency} dependency the dependency to generate
	 * @param {InitFragment[]} initFragments mutable list of init fragments
	 * @param {ReplaceSource} source the current replace source which can be modified
	 * @param {GenerateContext} generateContext the render context
	 * @returns {void}
	 */
	sourceDependency(module, dependency, initFragments, source, generateContext) {
		const constructor = /** @type {new (...args: any[]) => Dependency} */ (
			dependency.constructor
		);
		// 找到 dependency 对应的 template
		const template = generateContext.dependencyTemplates.get(constructor);
		if (!template) {
			throw new Error(
				"No template for dependency: " + dependency.constructor.name
			);
		}

		const templateContext = {
			runtimeTemplate: generateContext.runtimeTemplate,
			dependencyTemplates: generateContext.dependencyTemplates,
			moduleGraph: generateContext.moduleGraph,
			chunkGraph: generateContext.chunkGraph,
			module,
			runtime: generateContext.runtime,
			runtimeRequirements: generateContext.runtimeRequirements,
			concatenationScope: generateContext.concatenationScope,
			codeGenerationResults: generateContext.codeGenerationResults,
			initFragments
		};

		// 调用 template.apply，传入 source、initFragments
		// template.apply()的实现也是根据实际类型进行区分的，比如template.apply可能是ConstDependency.Template.apply，也可能是HarmonyImportDependency.Template.apply
    // 在 apply 函数可以直接修改 source 内容，或者更改 initFragments 数组，影响后续转译逻辑
		template.apply(dependency, source, templateContext);

		// TODO remove in webpack 6
		if ("getInitFragments" in template) {
			const fragments = deprecatedGetInitFragments(
				template,
				dependency,
				templateContext
			);

			if (fragments) {
				for (const fragment of fragments) {
					// 使用initFragments.push()增加一些代码片段
					initFragments.push(fragment);
				}
			}
		}
	}
}

module.exports = JavascriptGenerator;
