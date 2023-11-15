/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Ivan Kopeykin @vankop
*/

"use strict";

/** @typedef {import("./fs").InputFileSystem} InputFileSystem */
/** @typedef {(error: Error|null, result?: Buffer) => void} ErrorFirstCallback */

const backSlashCharCode = "\\".charCodeAt(0);
const slashCharCode = "/".charCodeAt(0);
const aLowerCaseCharCode = "a".charCodeAt(0);
const zLowerCaseCharCode = "z".charCodeAt(0);
const aUpperCaseCharCode = "A".charCodeAt(0);
const zUpperCaseCharCode = "Z".charCodeAt(0);
const _0CharCode = "0".charCodeAt(0);
const _9CharCode = "9".charCodeAt(0);
const plusCharCode = "+".charCodeAt(0);
const hyphenCharCode = "-".charCodeAt(0);
const colonCharCode = ":".charCodeAt(0);
const hashCharCode = "#".charCodeAt(0);
const queryCharCode = "?".charCodeAt(0);
/**
 * Get scheme if specifier is an absolute URL specifier
 * e.g. Absolute specifiers like 'file:///user/webpack/index.js'
 * https://tools.ietf.org/html/rfc3986#section-3.1
 * @param {string} specifier specifier
 * @returns {string|undefined} scheme if absolute URL specifier provided
 */
/** 举例：
let specifier = "https://www.example.com";
let scheme = getScheme(specifier);
console.log(scheme);  // 输出: "https"
// 在这个例子中，specifier是一个绝对 URL 规范，getScheme函数将返回该规范的 scheme 部分，即"https"。
 */
function getScheme(specifier) {
	const start = specifier.charCodeAt(0);

	// 检查specifier的第一个字符是否在小写字母a到z之间或大写字母A到Z之间。如果不是，则返回undefined
	// First char maybe only a letter
	if (
		(start < aLowerCaseCharCode || start > zLowerCaseCharCode) &&
		(start < aUpperCaseCharCode || start > zUpperCaseCharCode)
	) {
		return undefined;
	}

	let i = 1;
	let ch = specifier.charCodeAt(i);

	// 逐个检查每个字符是否在小写字母a到z之间、大写字母A到Z之间、数字0到9之间、加号+、破折号-之间。如果遇到了specifier的末尾，则返回undefined
	while (
		(ch >= aLowerCaseCharCode && ch <= zLowerCaseCharCode) ||
		(ch >= aUpperCaseCharCode && ch <= zUpperCaseCharCode) ||
		(ch >= _0CharCode && ch <= _9CharCode) ||
		ch === plusCharCode ||
		ch === hyphenCharCode
	) {
		if (++i === specifier.length) return undefined;
		ch = specifier.charCodeAt(i);
	}

	// Scheme must end with colon
	if (ch !== colonCharCode) return undefined;

	// Check for Windows absolute path
	// https://url.spec.whatwg.org/#url-miscellaneous
	if (i === 1) {
		const nextChar = i + 1 < specifier.length ? specifier.charCodeAt(i + 1) : 0;
		if (
			nextChar === 0 ||
			nextChar === backSlashCharCode ||
			nextChar === slashCharCode ||
			nextChar === hashCharCode ||
			nextChar === queryCharCode
		) {
			return undefined;
		}
	}

	return specifier.slice(0, i).toLowerCase();
}

/**
 * @param {string} specifier specifier
 * @returns {string | null | undefined} protocol if absolute URL specifier provided
 */
function getProtocol(specifier) {
	const scheme = getScheme(specifier);
	return scheme === undefined ? undefined : scheme + ":";
}

exports.getScheme = getScheme;
exports.getProtocol = getProtocol;
