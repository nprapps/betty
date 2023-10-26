var assert = require("assert");
var fs = require("fs");
var { parse } = require("./index");

var testFiles = fs.readdirSync("tests");
var passed = 0;
var possible = testFiles.length + 1;

// archieML tests
for (var f of testFiles) {
  var contents = fs.readFileSync(`tests/${f}`, "utf-8");
  var product = parse(contents, { verbose: false });
  var { test, result } = product;
  delete product.test
  delete product.result;
  result = JSON.parse(result);
  console.log(`\n==== ${f} ====`);
  console.log("TEST: ",  test);
  console.log("EXPECTED: ", JSON.stringify(result));
  console.log("FOUND: ", JSON.stringify(product));
  try {
    assert.deepStrictEqual(result, product);
    console.log(`RESULT: passed`);
    passed++;
  } catch (err) {
    console.error(err.message)
    console.log(`RESULT: failed`);
  }
}

// custom tests
console.log(`\n==== Betty extensions ====`)
var text = fs.readFileSync("test_document.txt", "utf-8");
var parsed = parse(text, {
  verbose: true,
  onFieldName: t => t.toLowerCase(),
  onValue: function(value) {
    if (value == "true" || value == "false") {
      return value == "true";
    }
    if (typeof value == "string" && value.match(/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}:\d{2}.\d+Z$/)) {
      return Date.parse(value);
    }
    var attempt = parseFloat(value);
    if (!isNaN(attempt)) return attempt;
    return value;
  }
});
//console.log(JSON.stringify(parsed, null, 2));
try {
  assert.deepStrictEqual(parsed, {
    hello: "world",
    options: {
      test: true,
      x: false,
      longer: `this is a block

It can contain markup

[and]
it won't care

this: isn't a field`,
      multiline: "this is a standard multiline value",
      child: {
        block: true
      }
    },
    not: "in options",

    free: { form: [
      { type: "text", value: "this is a test block" },
      { type: "key", value: "value" },
      { type: "quote", value: {
        text: "Correctly parses."
      }}
    ] },
    quote: {
      error: "This should exit the array."
    },
    strings: [
      "test",
      "a",
      "b",
      "longer string goes here: the sequel"
    ],

    list: [
      { a: 1, b: 2, c: { x: { d: 1, lengthy: "deeply nested multiline" } } },
      { a: 3 },
      { a: 4 }
    ],
    parent: [
      {
        nested: [
          "one",
          "two"
        ]
      }
    ],
    named: { 
      sub: {
        inner: {
          prop: "This is a named object"
        }
      },
      outer: "Closing only one level"
    },
    closing: "out of list",
    timestamp: Date.parse("2020-02-10T15:00:00.000Z")
  });
  console.log(`RESULT: passed`)
  passed++
} catch (err) {
  throw err;
}

console.log(`\n==== Final result summary ====
Passed: ${passed} of ${possible}`);