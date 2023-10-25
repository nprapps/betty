var identity = c => c;

// take a single stream of tokens and reorganizes it back into lines
// since this is a generator, you can for...of or spread it
var realign = function*(stream) {
  var line = [];
  for (var i = 0; i < stream.length; i++) {
    var token = stream[i];
    line.push(token);
    if (token.value == "\n") {
      yield line;
      line = [];
    }
  }
  yield line;
};

var combine = array => array.map(t => t.value).join("");

// removes whitespace tokens from the start of a line
var trimStart = function(tokens) {
  var line = tokens.slice();
  while (line.length && line[0].value.trim() == "") line.shift();
  return line;
};

class Parser {
  constructor(options = {}) {
    this.options = options;
    this.index = 0;
    this.instructions = [];
    this.lines = [];
  }

  /*
  parse() processes a stream of tokens and calls methods based on pattern-matching
  The result is a list of instructions that are used to assemble the final data object.
  */

  parse(tokens) {
    this.index = 0;
    this.instructions = [];
    this.lines = [...realign(tokens)];
    while (this.index < this.lines.length) {

      // on ignore, quit parsing
      if (this.matchValues(":", /^ignore/i) && this.matchTypes("COLON")) {
        return this.instructions;
      }

      // skip takes precedence
      if (this.matchValues(":", /^skip/i) && this.matchTypes("COLON")) {
        this.skipCommand();
        continue;
      }

      // type-defined grammar
      // specifies a parsing function, followed by its token pattern
      var typeMatched = [
        [this.singleValue, "TEXT", "COLON", "TEXT"],
        [this.multilineValue, "TEXT", "COLON", "COLON", "TEXT"],
        [this.simpleListValue, "STAR", "TEXT"],
        [this.objectOpen, "LEFT_BRACE", "TEXT", "RIGHT_BRACE"],
        [this.objectClose, "LEFT_BRACE", "RIGHT_BRACE"],
        [this.objectCloseNamed, "LEFT_BRACE", "SLASH", "TEXT", "RIGHT_BRACE"],
        [this.arrayOpen, "LEFT_BRACKET", "TEXT", "RIGHT_BRACKET"],
        [this.arrayClose, "LEFT_BRACKET", "RIGHT_BRACKET"],
        [this.arrayCloseNamed, "LEFT_BRACKET", "SLASH", "TEXT", "RIGHT_BRACKET"]
      ];

      // find a matching pattern and call it
      var handled = typeMatched.some(([fn, ...types]) => {
        if (this.matchTypes(...types)) {
          // parse functions can return true to reject the match
          var error = fn.call(this);
          return !error && true;
        }
      });
      if (handled) continue;

      // in case of :end
      if (this.matchValues(":", /^end(?!skip)/i) && this.matchTypes("COLON")) {
        this.flushBuffer();
        continue;
      }

      // accumulate text
      this.buffer();
    }
    return this.instructions;
  }

  log(...args) {
    if (!this.options.verbose) return;
    console.log(
      args
        .join(" ")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
    );
  }

  // create and output an instruction
  addInstruction(type, key, value) {
    this.instructions.push({ type, key, value });
  }

  /*
  methods for checking and consuming tokens
  */

  // move to the next line
  advance() {
    var line = this.lines[this.index];
    this.index++;
    return line;
  }

  // look ahead by offset lines
  peek(offset = 0) {
    return this.lines[this.index + offset];
  }

  // match against token types
  matchTypes(...types) {
    var line = trimStart(this.peek());
    return types.every((t, i) => line[i] && t == line[i].type);
  }

  // match against values
  // this is useful for things like multiline values,
  // where the end tag varies based on the opening key
  matchValues(...values) {
    var line = trimStart(this.peek());
    return values.every(function(v, i) {
      if (i >= line.length) return false;
      var token = line[i].value;
      if (v instanceof RegExp) {
        return token.match(v);
      } else {
        return token == v;
      }
    });
  }

  /*
  Methods for parsing sets of tokens
  Each method examines the current line, and adds the corresponding
  instructions to be used by the assembler in the next step
  */

  // skip: through :endskip
  skipCommand() {
    this.log(`Encountered skip tag`);
    while (
      this.index < this.lines.length &&
      !this.matchValues(":", /^endskip/i)
    ) {
      var skipped = this.advance();
      this.log(` > Skipping text: "${combine(skipped)}"`);
    }
    this.addInstruction("skipped");
  }

  // key: value
  singleValue() {
    // get key and colon
    var [key, _, ...values] = trimStart(this.peek());
    var k = key.value.trim();
    // check for valid keys
    if (!k.length || k.match(/[\s\?\/="']/)) {
      return true;
    }
    var value = combine(values);
    // assign value
    this.addInstruction("value", k, value);
    this.advance();
  }

  // key:: multiple lines of value ::key
  multilineValue() {
    var [key, c1, c2, ...values] = trimStart(this.peek());
    var k = key.value.trim();
    // check for valid keys
    if (!k.length || k.match(/[\s\?\/="']/)) {
      return true;
    }
    this.advance();
    var next;
    var ender = k.toLowerCase();
    while (next = this.peek()) {
      if (this.matchValues(":", ":", new RegExp(ender, "i"))) {
        break;
      }
      values.push(...next);
      this.advance();
    }
    var value = combine(values);
    this.addInstruction("value", k, value);
    this.advance();
  }

  // * item
  simpleListValue() {
    // pass the star
    var [star, ...values] = trimStart(this.advance());
    this.addInstruction("simple", star.value, combine(values));
  }

  // {objectKey}
  objectOpen() {
    // ignore the bracket, get the key name
    var [_, key] = trimStart(this.peek());
    var k = key.value.trim();
    // handle {}, which closes an object
    if (!k) {
      return this.objectClose();
    }
    // by default, creates a new object at the root
    this.addInstruction("object", k);
    this.advance();
  }

  objectClose() {
    this.addInstruction("closeObject");
    this.advance();
  }

  objectCloseNamed() {
    var [brace, slash, key] = trimStart(this.advance());
    this.addInstruction("closeObject", key.value);
  }

  // [arrayKey]
  arrayOpen() {
    var [_, key] = trimStart(this.peek());
    var k = key.value.trim();
    if (!k) {
      return this.arrayClose();
    }
    this.addInstruction("array", k);
    this.advance();
  }

  arrayClose() {
    this.addInstruction("closeArray");
    this.advance();
  }

  arrayCloseNamed() {
    var [bracket, slash, key] = trimStart(this.advance());
    this.addInstruction("closeArray", key.value);
  }

  // text is added to a generic buffer, since its use depends on the previous instructions
  buffer() {
    var values = this.advance();
    this.addInstruction("buffer", null, combine(values));
  }

  // signals that text has finished and should be merged
  flushBuffer() {
    this.addInstruction("flush");
    this.advance();
  }
}

module.exports = Parser;
