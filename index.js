var { tokenize } = require("./tokenizer");
var Parser = require("./parser");
var Assembler = require("./assembler");

var identity = t => t;

var defaultOptions = {
  verbose: false,
  onFieldName: identity,
  onValue: identity
};

var facade = {
  parse: function(text, settings) {
    var options = Object.assign({}, defaultOptions, settings);
    text = text.replace(/\r/g, "");
    var tokens = tokenize(text);
    // console.log(tokens);
    var parser = new Parser(options);
    var instructions = parser.parse(tokens);
    var assembler = new Assembler(options);
    var output = assembler.assemble(instructions);
    // console.log(output);
    return output;
  }
};

module.exports = facade;