var { tokenize } = require("./tokenizer");
var Parser = require("./parser");

var facade = {
  parse: function(text, options) {
    var tokens = tokenize(text);
    // console.log(tokens);
    var parser = new Parser(tokens, options);
    var output = parser.parse();
    // console.log(output);
    return output;
  }
};

module.exports = facade;