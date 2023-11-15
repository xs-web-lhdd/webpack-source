/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const { SyncHook } = require("tapable");

/**
 * @typedef {Object} RuleCondition
 * @property {string | string[]} property
 * @property {boolean} matchWhenEmpty
 * @property {function(string): boolean} fn
 */

/**
 * @typedef {Object} Condition
 * @property {boolean} matchWhenEmpty
 * @property {function(string): boolean} fn
 */

/**
 * @typedef {Object} CompiledRule
 * @property {RuleCondition[]} conditions
 * @property {(Effect|function(object): Effect[])[]} effects
 * @property {CompiledRule[]=} rules
 * @property {CompiledRule[]=} oneOf
 */

/**
 * @typedef {Object} Effect
 * @property {string} type
 * @property {any} value
 */

/**
 * @typedef {Object} RuleSet
 * @property {Map<string, any>} references map of references in the rule set (may grow over time)
 * @property {function(object): Effect[]} exec execute the rule set
 */

class RuleSetCompiler {
	constructor(plugins) {
		this.hooks = Object.freeze({
			/** @type {SyncHook<[string, object, Set<string>, CompiledRule, Map<string, any>]>} */
			rule: new SyncHook([
				"path",
				"rule",
				"unhandledProperties",
				"compiledRule",
				"references"
			])
		});
		if (plugins) {
			for (const plugin of plugins) {
				plugin.apply(this);
			}
		}
	}

	/**
	 * @param {object[]} ruleSet raw user provided rules
	 * @returns {RuleSet} compiled RuleSet
	 */
	// ruleSet 两个数组集合，第一个是默认的配置参数，第二个是我们在webpack.config.js中设置的loaders的参数配置
	compile(ruleSet) {
		const refs = new Map();
		const rules = this.compileRules("ruleSet", ruleSet, refs);

		/**
		 * @param {object} data data passed in
		 * @param {CompiledRule} rule the compiled rule
		 * @param {Effect[]} effects an array where effects are pushed to
		 * @returns {boolean} true, if the rule has matched
		 */
		const execRule = (data, rule, effects) => {
			for (const condition of rule.conditions) {
				const p = condition.property;
				if (Array.isArray(p)) {
					let current = data;
					for (const subProperty of p) {
						if (
							current &&
							typeof current === "object" &&
							Object.prototype.hasOwnProperty.call(current, subProperty)
						) {
							current = current[subProperty];
						} else {
							current = undefined;
							break;
						}
					}
					if (current !== undefined) {
						if (!condition.fn(current)) return false;
						continue;
					}
				} else if (p in data) {
					const value = data[p];
					if (value !== undefined) {
						if (!condition.fn(value)) return false;
						continue;
					}
				}
				if (!condition.matchWhenEmpty) {
					return false;
				}
			}
			for (const effect of rule.effects) {
				if (typeof effect === "function") {
					const returnedEffects = effect(data);
					for (const effect of returnedEffects) {
						effects.push(effect);
					}
				} else {
					effects.push(effect);
				}
			}
			if (rule.rules) {
				for (const childRule of rule.rules) {
					execRule(data, childRule, effects);
				}
			}
			if (rule.oneOf) {
				for (const childRule of rule.oneOf) {
					if (execRule(data, childRule, effects)) {
						break;
					}
				}
			}
			return true;
		};

		return {
			references: refs,
			// 根据初始化时的rules数据集合，传入数据data，然后进行每一个rule的筛选，本质就是传入一个路径，然后根据路径检测出需要使用什么loader
			exec: data => { // 对rules进行一系列逻辑筛选data所应该持有的loaders
				/** @type {Effect[]} */
				const effects = [];
				for (const rule of rules) {
					execRule(data, rule, effects);
				}
				return effects;
			}
		};
	}

	/**
	 * @param {string} path current path
	 * @param {object[]} rules the raw rules provided by user
	 * @param {Map<string, any>} refs references
	 * @returns {CompiledRule[]} rules
	 */
	// 这是为了拼接exec()方法中的rules对象，具有conditions、effects、rules、oneOf四个属性
	// 该方法分为两块内容：
	//     1、compiledRule对象4个属性的构建
	//     2、this.hooks.rule.call()的调用
	compileRules(path, rules, refs) {
		return rules
			.filter(Boolean)
			.map((rule, i) => this.compileRule(`${path}[${i}]`, rule, refs));
	}

	/**
	 * @param {string} path current path
	 * @param {object} rule the raw rule provided by user
	 * @param {Map<string, any>} refs references
	 * @returns {CompiledRule} normalized and compiled rule for processing
	 */
	compileRule(path, rule, refs) {
		const unhandledProperties = new Set(
			Object.keys(rule).filter(key => rule[key] !== undefined)
		);

		/** @type {CompiledRule} */
		const compiledRule = {
			conditions: [], // 是test、include、exclude、resourceQuery等条件的筛选，放在conditions中，具体可以查看webpack官方文档
			effects: [], // 是loader、options等条件的筛选，指定要使用哪个loader以及对应的配置参数以及对应的路径放在effects中
			rules: undefined, // 存放子规则，一开始传入的ruleSet是两个数组集合，我们需要解析出来，然后将数组里面的每一个item都解析成一个rules
			oneOf: undefined // 规则数组，当规则匹配时，只使用第一个匹配规则。
		};

		// 触发UseEffectRulePlugin、BasicEffectRulePlugin、BasicMatcherRulePlugin、ObjectMatcherRulePlugin进行传入的compiledRule的数据添加
		// 本质就是根据注册的插件，往compiledRule集合数据添加数据，以便于后面执行exec()
		// 这些Plugin都是在RuleSetCompiler初始化的时候就注册钩子了，在NormalFactory中初始化时就注册了
		// 拼接compiledRule.conditions数据
    // 拼接compiledRule.effects数据
		this.hooks.rule.call(path, rule, unhandledProperties, compiledRule, refs);

		if (unhandledProperties.has("rules")) {
			unhandledProperties.delete("rules");
			const rules = rule.rules;
			if (!Array.isArray(rules))
			throw this.error(path, rules, "Rule.rules must be an array of rules");
			// 拼接compiledRule.rules数据
			compiledRule.rules = this.compileRules(`${path}.rules`, rules, refs);
		}

		if (unhandledProperties.has("oneOf")) {
			unhandledProperties.delete("oneOf");
			const oneOf = rule.oneOf;
			if (!Array.isArray(oneOf))
				throw this.error(path, oneOf, "Rule.oneOf must be an array of rules");
			// 拼接compiledRule.oneOf数据
			compiledRule.oneOf = this.compileRules(`${path}.oneOf`, oneOf, refs);
		}

		if (unhandledProperties.size > 0) {
			throw this.error(
				path,
				rule,
				`Properties ${Array.from(unhandledProperties).join(", ")} are unknown`
			);
		}

		return compiledRule;
	}

	/**
	 * @param {string} path current path
	 * @param {any} condition user provided condition value
	 * @returns {Condition} compiled condition
	 */
	compileCondition(path, condition) {
		if (condition === "") {
			return {
				matchWhenEmpty: true,
				fn: str => str === ""
			};
		}
		if (!condition) {
			throw this.error(
				path,
				condition,
				"Expected condition but got falsy value"
			);
		}
		if (typeof condition === "string") {
			return {
				matchWhenEmpty: condition.length === 0,
				fn: str => typeof str === "string" && str.startsWith(condition)
			};
		}
		if (typeof condition === "function") {
			try {
				return {
					matchWhenEmpty: condition(""),
					fn: condition
				};
			} catch (err) {
				throw this.error(
					path,
					condition,
					"Evaluation of condition function threw error"
				);
			}
		}
		if (condition instanceof RegExp) {
			return {
				matchWhenEmpty: condition.test(""),
				fn: v => typeof v === "string" && condition.test(v)
			};
		}
		if (Array.isArray(condition)) {
			const items = condition.map((c, i) =>
				this.compileCondition(`${path}[${i}]`, c)
			);
			return this.combineConditionsOr(items);
		}

		if (typeof condition !== "object") {
			throw this.error(
				path,
				condition,
				`Unexpected ${typeof condition} when condition was expected`
			);
		}

		const conditions = [];
		for (const key of Object.keys(condition)) {
			const value = condition[key];
			switch (key) {
				case "or":
					if (value) {
						if (!Array.isArray(value)) {
							throw this.error(
								`${path}.or`,
								condition.and,
								"Expected array of conditions"
							);
						}
						conditions.push(this.compileCondition(`${path}.or`, value));
					}
					break;
				case "and":
					if (value) {
						if (!Array.isArray(value)) {
							throw this.error(
								`${path}.and`,
								condition.and,
								"Expected array of conditions"
							);
						}
						let i = 0;
						for (const item of value) {
							conditions.push(this.compileCondition(`${path}.and[${i}]`, item));
							i++;
						}
					}
					break;
				case "not":
					if (value) {
						const matcher = this.compileCondition(`${path}.not`, value);
						const fn = matcher.fn;
						conditions.push({
							matchWhenEmpty: !matcher.matchWhenEmpty,
							fn: v => !fn(v)
						});
					}
					break;
				default:
					throw this.error(
						`${path}.${key}`,
						condition[key],
						`Unexpected property ${key} in condition`
					);
			}
		}
		if (conditions.length === 0) {
			throw this.error(
				path,
				condition,
				"Expected condition, but got empty thing"
			);
		}
		return this.combineConditionsAnd(conditions);
	}

	/**
	 * @param {Condition[]} conditions some conditions
	 * @returns {Condition} merged condition
	 */
	combineConditionsOr(conditions) {
		if (conditions.length === 0) {
			return {
				matchWhenEmpty: false,
				fn: () => false
			};
		} else if (conditions.length === 1) {
			return conditions[0];
		} else {
			return {
				matchWhenEmpty: conditions.some(c => c.matchWhenEmpty),
				fn: v => conditions.some(c => c.fn(v))
			};
		}
	}

	/**
	 * @param {Condition[]} conditions some conditions
	 * @returns {Condition} merged condition
	 */
	combineConditionsAnd(conditions) {
		if (conditions.length === 0) {
			return {
				matchWhenEmpty: false,
				fn: () => false
			};
		} else if (conditions.length === 1) {
			return conditions[0];
		} else {
			return {
				matchWhenEmpty: conditions.every(c => c.matchWhenEmpty),
				fn: v => conditions.every(c => c.fn(v))
			};
		}
	}

	/**
	 * @param {string} path current path
	 * @param {any} value value at the error location
	 * @param {string} message message explaining the problem
	 * @returns {Error} an error object
	 */
	error(path, value, message) {
		return new Error(
			`Compiling RuleSet failed: ${message} (at ${path}: ${value})`
		);
	}
}

module.exports = RuleSetCompiler;
