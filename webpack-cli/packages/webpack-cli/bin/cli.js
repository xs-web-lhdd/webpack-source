#!/usr/bin/env node

"use strict";

// 当我们本地node_modules存在一个脚手架命令，同时全局node_modules中也存在这个脚手架命令的时候，优先选用**本地node_modules**中的版本
const importLocal = require("import-local");
const runCLI = require("../lib/bootstrap");

if (!process.env.WEBPACK_CLI_SKIP_IMPORT_LOCAL) {
  // Prefer the local installation of `webpack-cli`
  if (importLocal(__filename)) {
    return;
  }
}

// 更改进程名称为 webpack
process.title = "webpack";

runCLI(process.argv);
