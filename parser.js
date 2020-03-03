var identity = c => c;

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
  */

  parse(tokens) {
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
      var typeMatched = [
        [this.singleValue, "TEXT", "COLON", "TEXT"],
        [this.multilineValue, "TEXT", "COLON", "COLON", "TEXT"],
        [this.simpleListValue, "STAR", "TEXT"],
        [this.objectOpen, "LEFT_BRACE", "TEXT", "RIGHT_BRACE"],
        [this.objectClose, "LEFT_BRACE", "RIGHT_BRACE"],
        [this.arrayOpen, "LEFT_BRACKET", "TEXT", "RIGHT_BRACKET"],
        [this.arrayClose, "LEFT_BRACKET", "RIGHT_BRACKET"]
      ];

      var handled = typeMatched.some(([fn, ...types]) => {
        if (this.matchTypes(...types)) {
          // these can return true if they couldn't match
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

  advance() {
    var line = this.lines[this.index];
    this.index++;
    return line;
  }

  peek(offset = 0) {
    return this.lines[this.index + offset];
  }

  matchTypes(...types) {
    var line = trimStart(this.peek());
    return types.every((t, i) => line[i] && t == line[i].type);
  }

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
  methods for parsing sets of tokens
  */

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
      var trimmed = trimStart(next);
      var third = trimmed[2] ? trimmed[2].value : "";
      if (
        this.matchTypes("COLON", "COLON") &&
        third.trim().toLowerCase() == ender
      ) {
        break;
      }
      values.push(...next);
      this.advance();
    }
    var value = combine(values);
    this.addInstruction("value", k, value);
    this.advance();
  }

  simpleListValue() {
    // pass the star
    var [star, ...values] = trimStart(this.advance());
    this.addInstruction("simple", star.value, combine(values));
  }

  objectOpen() {
    var [_, key] = trimStart(this.peek());
    var k = key.value.trim();
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

  buffer() {
    var values = this.advance();
    this.addInstruction("buffer", null, combine(values));
  }

  flushBuffer() {
    this.addInstruction("flush");
    this.advance();
  }
}

module.exports = Parser;
