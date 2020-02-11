var fs = require("fs");
var { parse } = require("./index");

var text = fs.readFileSync("test_document.txt", "utf-8");
var parsed = parse(text, {
  onFieldName: t => t.toLowerCase(),
  onValue: function(value) {
    if (value == "true" || value == "false") {
      return value == "true";
    }
    var attempt = parseFloat(value);
    if (!isNaN(attempt)) return attempt;
    return value;
  }
});
console.log(JSON.stringify(parsed, null, 2));