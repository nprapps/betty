var identity = c => c;

class Parser {
  constructor(tokenList, options = {}) {
    this.tokens = tokenList;
    this.options = options;
    this.index = 0;
    this.instructions = [];
  }

  /*
  parse() processes a stream of tokens and calls methods based on pattern-matching
  */

  parse() {
    while (this.index < this.tokens.length) {
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
        [this.arrayClose, "LEFT_BRACKET", "RIGHT_BRACKET"],
        [this.escape, "BACKSLASH"]
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
        this.restOfLine();
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

  advance(amount = 1) {
    var sliced = this.tokens.slice(this.index, this.index + amount);
    this.index += amount;
    return sliced;
  }

  restOfLine() {
    var acc = [];
    var [next] = this.peek();
    while (next && next.value != "\n") {
      acc.push(next);
      this.advance();
      [next] = this.peek();
    }
    // absorb the newline we found
    var [found] = this.advance();
    if (found) acc.push(found);
    return acc.map(t => t.value).join("");
  }

  peek(amount = 1) {
    var sliced = this.tokens.slice(this.index, this.index + amount);
    return sliced;
  }

  matchTypes(...types) {
    var tokens = this.peek(types.length).map(n => n.type);
    return types.every((t, i) => t == tokens[i]);
  }

  matchValues(...values) {
    var tokens = this.peek(values.length).filter(Boolean);
    return values.every(function(v, i) {
      if (i >= tokens.length) return false;
      var token = tokens[i].value;
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
    this.advance(2);
    while (
      !this.matchValues(":", /^endskip/i) &&
      this.index < this.tokens.length - 2
    ) {
      var [skipped] = this.advance();
      this.log(` > Skipping text: "${skipped.value}"`);
    }
    this.addInstruction("skipped");
    this.restOfLine();
  }

  escape() {
    var [here, next, after] = this.peek(3);
    next.type = "ESCAPED";
    this.buffer();
  }

  singleValue() {
    // get key and colon
    var [key] = this.peek();
    var k = key.value.trim();
    // check for valid keys
    if (!k.length || k.match(/[\s]/)) {
      return true;
    }
    this.advance(2);
    // get values up through the line break
    var value = this.restOfLine();
    // assign value
    this.addInstruction("value", k, value);
  }

  multilineValue() {
    var [key] = this.advance(3).map(t => t.value.trim());
    if (!key) return true;
    var words = [this.advance().value];
    while (this.index < this.tokens.length) {
      // advance until we see the ending tag
      var third = this.peek(3)[2];
      third = third ? third.value.trim() : "";
      if (
        this.matchTypes("COLON", "COLON") &&
        third.toLowerCase() == key.toLowerCase()
      ) {
        this.advance(3);
        break;
      }
      var [word] = this.advance();
      words.push(word.value);
    }
    var value = words.join("");
    this.addInstruction("value", key, value);
  }

  simpleListValue() {
    // pass the star
    var [star] = this.advance();
    var value = this.restOfLine();
    this.addInstruction("simple", star.value, value);
  }

  objectOpen() {
    var [_, key] = this.advance(3).map(t => t.value.trim());
    if (!key) {
      this.index -= 2;
      return this.objectClose();
    }
    // by default, creates a new object at the root
    this.addInstruction("object", key);
  }

  objectClose() {
    this.addInstruction("closeObject");
    this.advance(2);
  }

  arrayOpen() {
    var [_, key] = this.advance(3).map(t => t.value);
    key = key.trim();
    if (!key) {
      // close the array instead
      this.advance(-2);
      this.arrayClose();
      return;
    }
    this.addInstruction("array", key);
  }

  arrayClose() {
    this.addInstruction("closeArray");
    this.advance(2);
  }

  buffer() {
    var [token] = this.advance();
    this.addInstruction("buffer", null, token.value);
  }

  flushBuffer() {
    this.addInstruction("flush");
    this.advance(2);
  }
}

module.exports = Parser;
