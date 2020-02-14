var fs = require("fs");
var { parse } = require("./index");
var assert = require("assert");

var testFiles = fs.readdirSync("tests");
for (var f of testFiles) {
  console.log(`====start ${f}====`);
  var contents = fs.readFileSync(`tests/${f}`, "utf-8");
  var product = parse(contents, { verbose: false });
  var { test, result } = product;
  delete product.test
  delete product.result;
  result = JSON.parse(result);
  console.log(`====result ${f}====`);
  console.log("TEST: ",  test);
  console.log("EXPECTED: ", JSON.stringify(result));
  console.log("FOUND: ", JSON.stringify(product));
  assert.deepEqual(result, product);
}