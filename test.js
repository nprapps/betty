var assert = require("assert");
var fs = require("fs");
var { parse } = require("./index");

var text = fs.readFileSync("test_document.txt", "utf-8");
var parsed = parse(text, {
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

assert.strict.deepEqual(parsed, {
  hello: "world",
  options: {
    test: true,
    x: false,
    longer: `this is a block

It can contain markup

[and]
it won't care

this: isn't a field`,
    child: {
      block: true
    }
  },
  not: "in options",
  list: [
    { a: 1, b: 2, c: { x: { d: 1 } } },
    { a: 3 },
    { a: 4 }
  ],
  closing: "out of list",
  timestamp: Date.parse("2020-02-10T15:00:00.000Z")
});
console.log("PASSED: Expected value matched parse")
