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

    var tokens = tokenize(text);
    // console.log(tokens);
    var parser = new Parser(tokens, options);
    var instructions = parser.parse();
    var assembler = new Assembler(options);
    var output = assembler.assemble(instructions);
    // console.log(output);
    return output;
  }
};

module.exports = facade;