var identity = c => c;

var ARRAY_TYPE = Symbol();

var assignType = (array, value) =>
  Object.defineProperty(array, ARRAY_TYPE, {
    value,
    enumerable: false,
    configurable: true
  });

var defaultOptions = {
  verbose: false,
  onFieldName: identity,
  onValue: identity,
  allowDuplicateKeys: true
};

class Parser {
  constructor(tokenList, options = {}) {
    this.tokens = tokenList;
    this.options = Object.assign({}, defaultOptions, options);
    this.index = 0;
    this.root = {};
    this.stack = [this.root];
    this.lastKey = null;
    this.backBuffer = [];
  }

  /*
  parse() processes a stream of tokens and calls methods based on pattern-matching
  */

  parse() {
    while (this.index < this.tokens.length) {

      // on ignore, quit parsing
      if (this.matchValues(":", /^ignore/i) && this.matchTypes("COLON")) {
        return this.root;
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
      ]

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

      var [p] = this.peek();
      this.log(
        `Accumulating possible text ${p.value.replace(/\n/g, "\\n")}`
      );
      // freeform arrays can accumulate text as an entry
      if (this.top[ARRAY_TYPE] == "freeform" && p.value.trim()) {
        this.top.push({ type: "text", value: this.restOfLine().trim() });
      } else {
        this.backBuffer.push(p);
        this.advance();
      }
    }
    return this.root;
  }

  log(...args) {
    if (!this.options.verbose) return;
    console.log(args.join(" ").replace(/\n/g, "\\n"));
  }

  /*
  methods for working with the context stack
  */

  get top() {
    return this.stack[this.stack.length - 1];
  }

  push(object) {
    this.stack.push(object);
  }

  pop() {
    var popped = this.stack.pop();
    if (this.stack.length == 0) this.stack.push(this.root);
    return this.top;
  }

  reset(object) {
    this.log(`Resetting to root scope`);
    this.stack = [this.root];
    if (object) this.push(object);
  }

  getTarget(key) {
    if (key[0] == ".") {
      return this.top;
    }
    this.reset();
    return this.root;
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
  methods for working with object keypaths
  */

  normalizeKeypath(keypath) {
    if (typeof keypath == "string") keypath = keypath.split(".");
    keypath = keypath.filter(identity);
    keypath = keypath.map(this.options.onFieldName);
    return keypath;
  }

  getPath(object, keypath) {
    keypath = this.normalizeKeypath(keypath);
    var terminal = keypath.pop();
    var branch = object;
    for (var k of keypath) {
      if (!(k in branch)) {
        return undefined;
      }
      branch = branch[k];
    }
    return branch && branch[terminal];
  }

  setPath(object, keypath, value) {
    keypath = this.normalizeKeypath(keypath);
    var terminal = keypath.pop().replace(/\+/g, "");
    var branch = object;
    for (var k of keypath) {
      if (!(k in branch) || typeof branch[k] != "object") {
        branch[k] = {};
      }
      branch = branch[k];
    }
    branch[terminal] = this.options.onValue(value, terminal);
    return branch;
  }

  remember(key, remainder = "\n") {
    this.log(`Remembering key ${key}`);
    this.lastKey = key;
    this.backBuffer = [{ type: "text", value: remainder }];
  }

  /*
  methods for adding values to the output object
  */

  appendValue(target, key, value) {
    if (target instanceof Array) {
      return this.addToArray(target, key, value);
    } else {
      if (typeof value == "string") value = value.trim();
      this.setPath(target, key, value);
      this.remember(key);
    }
  }

  // returns true if the addition was ignored
  addToArray(target, key, value) {
    this.remember(key);
    switch (target[ARRAY_TYPE]) {
      case "freeform":
        key = key.replace(/^[\.+]*/, "");
        if (typeof value == "string") value = value.trim();
        target.push({ type: key, value });
        break;

      case "simple":
        // simple arrays can't contain keyed values
        var combined = [key, value].join(":");
        this.log(`Accumulating line inside of simple list "${combined}"`);
        this.remember(null);
        this.backBuffer.push({ type: "TEXT", value: combined });
        break;

      default:
        if (!target[ARRAY_TYPE]) assignType(target, "standard");
        // add to the last object in the array
        var last = target[target.length - 1];
        if (!last || this.getPath(last, key)) {
          last = {};
          target.push(last);
        }
        if (typeof value == "string") value = value.trim();
        this.setPath(last, key, value);
    }
  }

  /*
  methods for parsing sets of tokens
  */

  skipCommand() {
    this.log(`Encountered skip tag`);
    this.advance(2);
    this.remember(-1);
    while (
      !this.matchValues(":", /^endskip/i) &&
      this.index < this.tokens.length - 2
    ) {
      var [skipped] = this.advance();
      this.log(`Skipping text: "${skipped.value}"`);
    }
    this.restOfLine();
  }

  escape() {
    var [here, next, after] = this.peek(3);
    this.log(`Escaping character ${next.value}`);
    next.type = "ESCAPED";
    this.backBuffer.push(here);
    this.advance();
  }

  singleValue() {
    // get key and colon
    var [key] = this.peek();
    var k = key.value.trim();
    // check for valid keys
    if (!k.length || k.match(/[\s]/)) {
      this.log(`Invalid key found: ${k}`);
      // return this.backBuffer.push(this.restOfLine());
      return true;
    }
    this.advance(2);
    // get values up through the line break
    var value = this.restOfLine();
    // assign value
    var target = this.top;
    this.log(`Encountered key/value pair for ${k}`)
    this.appendValue(target, k, value);
  }

  multilineValue() {
    this.remember(null);
    var [key] = this.advance(3).map(t => t.value.trim());
    if (!key) return true;
    this.log(`Opening multiline value at ${key}`);
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
    var target = this.top;
    var value = words.join("");
    this.appendValue(target, key, value);
  }

  simpleListValue() {
    // pass the star
    var [star] = this.advance();
    var value = this.restOfLine();
    if (
      this.top instanceof Array &&
      (!this.top[ARRAY_TYPE] || this.top[ARRAY_TYPE] == "simple")
    ) {
      this.log(`Assigning simple list value ${value.trim()}`);
      this.remember(null);
      this.top.push(value.trim());
      assignType(this.top, "simple");
    } else if (this.top[ARRAY_TYPE] == "freeform") {
      // add this as a freeform value
      this.addToArray(this.top, "text", star.value + value.replace(/\n/, ""));
    } else {
      // accumulate this
      value = star.value + value;
      this.log(`Accumulating simple list string ${value}`);
      this.backBuffer.push({ type: "text", value });
    }
  }

  objectOpen() {
    var [_, key] = this.advance(3).map(t => t.value.trim());
    if (!key) {
      this.index -= 2;
      return this.objectClose();
    }
    this.log(`Opening object at "${key}"`);
    // by default, creates a new object at the root
    var target = this.getTarget(key);
    var object = this.getPath(target, key);
    if (typeof object != "object") {
      object = {};
    }
    this.appendValue(target, key, object);
    this.push(object);
    this.remember(null);
  }

  objectClose() {
    this.log(`Closing object tag found`);
    this.pop();
    this.advance(2);
  }

  arrayOpen() {
    this.remember(null);
    var [_, key] = this.advance(3).map(t => t.value);
    key = key.trim();
    if (!key) {
      // close the array instead
      this.advance(-2);
      this.arrayClose();
      return;
    }
    this.log(`Creating array at ${key}`);
    var target = this.getTarget(key);
    var array = [];
    var last = this.normalizeKeypath(key).pop();
    if (last[0] == "+") {
      this.log(`Setting array as freeform: ${last}`);
      assignType(array, "freeform");
    }
    this.appendValue(target, key, array);
    this.push(array);
  }

  arrayClose() {
    this.log(`Closing array tag found`);
    // find the closest array
    while (this.top != this.root && !(this.top instanceof Array)) this.pop();
    this.pop();
    this.advance(2);
  }

  flushBuffer() {
    this.log(`Clearing buffer of ${this.backBuffer.length} items`);
    // assign to the last key and clear buffer
    var value = this.backBuffer.map(t => t.value).join("");
    var target = this.top;
    var join = (e, v) =>
      (e + v).trim().replace(/^\\/m, "");
    if (target[ARRAY_TYPE] == "simple" && !this.lastKey) {
      this.log(`Found :end for simple array value`);
      var existing = target.pop();
      var updated = join(existing, value);
      target.push(updated);
    } else {
      if (this.lastKey && this.lastKey != -1) {
        this.log(`Found :end for ${this.lastKey}`);
        if (target instanceof Array) {
          target = target[target.length - 1];
        }
        // handle empty arrays
        if (target) {
          var existing = this.getPath(target, this.lastKey);
          var updated = join(existing, value);
          this.setPath(target, this.lastKey, updated);
        }
      }
    }
    this.remember(null);
    this.advance(2);
  }

}

module.exports = Parser;
