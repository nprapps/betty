var identity = c => c;

var ARRAY_TYPE = Symbol();

var setArrayType = (array, value) => Object.defineProperty(array, ARRAY_TYPE, {
  value,
  enumerable: false,
  configurable: true
});

var defaultOptions = {
  verbose: false,
  onFieldName: identity,
  onValue: identity,
  allowDuplicateKeys: true
}

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

  log(...args) {
    if (!this.options.verbose) return;
    console.log(args.join(" ").replace(/\n/g, "\\n"));
  }

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

  match(...types) {
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

  normalizeKeypath(keypath) {
    if (typeof keypath == "string") keypath = keypath.split(".")
    keypath = keypath.filter(identity);
    keypath = keypath.map(this.options.onFieldName);
    return keypath
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
    return branch[terminal];
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

  appendValue(target, key, value) {
    if (target instanceof Array) {
      return this.addToArray(target, key, value);
    } else {
      if (typeof value == "string") value = value.trim();
      this.setPath(target, key, value);
    }
  }

  // returns true if the addition was ignored
  addToArray(target, key, value) {
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
        this.backBuffer.push({ type: "TEXT", value: combined });
        return true;
        break;

      default:
        if (!target[ARRAY_TYPE]) setArrayType(target, "standard");
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

  getTarget(key) {
    if (key[0] == ".") {
      return this.top;
    }
    this.reset();
    return this.root;
  }

  skipCommand() {
    this.log(`Encountered skip tag`);
    this.advance(2);
    this.remember(-1);
    while (!this.matchValues(":", /^endskip/i) && (this.index < this.tokens.length - 2)) {
      var [skipped] = this.advance();
      this.log(`Skipping text: "${skipped.value}"`)
    }
    this.restOfLine();
  }

  singleValue() {
    // get key and colon
    var [key] = this.peek();
    var k = key.value.trim();
    // check for valid keys
    if (k.match(/[\s]/)) {
      this.log(`Invalid key found: ${k}`)
      return this.backBuffer.push(this.restOfLine());
    }
    this.advance(2);
    // get values up through the line break
    var value = this.restOfLine();
    // assign value
    var target = this.top;
    var wasSimple = this.appendValue(target, k, value);
    if (!wasSimple) {
      this.log(`Encountered key value for ${k}`);
      this.remember(k);
    }
  }

  multilineValue() {
    this.remember(null);
    var [key] = this.advance(3).map(t => t.value.trim());
    this.log(`Opening multiline value at ${key}`);
    var words = [this.advance().value];
    while (this.index < this.tokens.length) {
      // advance until we see the ending tag
      var third = this.peek(3)[2]
      third = third ? third.value.trim() : "";
      if (this.match("COLON", "COLON") && third.toLowerCase() == key.toLowerCase()) {
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
    if (this.top instanceof Array && (!this.top[ARRAY_TYPE] || this.top[ARRAY_TYPE] == "simple")) {
      this.log(`Assigning simple list value ${value.trim()}`);
      this.remember(null);
      this.top.push(value.trim());
      setArrayType(this.top, "simple");
    } else if (this.top[ARRAY_TYPE] == "freeform") {
      // add this as a freeform value
      this.addToArray(this.top, "text", star.value + value.replace(/\n/, ""));
    } else {
      // accumulate this
      value = star.value + value;
      this.log(`Accumulating simple list string ${value}`)
      this.backBuffer.push({ type: "text", value });
    }
  }

  objectOpen() {
    var [_, key] = this.advance(3).map(t => t.value.trim());
    if (!key) {
      this.index -= 2;
      return this.objectClose();
    }
    this.remember(null);
    this.log(`Opening object at "${key}"`);
    // by default, creates a new object at the root
    var target = this.getTarget(key);
    var object = this.getPath(target, key);
    if (typeof object != "object") {
      object = {};
    }
    this.appendValue(target, key, object);
    this.push(object);
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
      this.log(`Setting array as freeform: ${last}`)
      setArrayType(array, "freeform");
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
    // assign to the last key and clear buffer
    var value = "\n" + this.backBuffer.map(t => t.value).join("");
    var target = this.top;
    var join = (e, v) => (e + "\n" + v.replace(/^\n/, "")).trim().replace(/^\\/m, "");
    console.log(this.lastKey);
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
        var existing = this.getPath(target, this.lastKey);
        var updated = join(existing, value);
        this.setPath(target, this.lastKey, updated);
      }
    }
    this.remember(null);
    this.advance(2);
  }

  remember(key) {
    this.log(`Remembering key ${key}`);
    this.lastKey = key;
    this.backBuffer = [];
  }

  parse() {

    while (this.index < this.tokens.length) {
      var previous = this.tokens[this.index - 1];
      var [peek] = this.peek();

      // on ignore, quit parsing
      if (this.matchValues(":", /^ignore/i) && this.match("COLON")) {
        break;
      }

      // skip takes precedence
      if (this.matchValues(":", /^skip/i) && this.match("COLON")) {
        this.skipCommand();
        continue;
      }


      // simple value fields
      if (this.match("TEXT", "COLON", "TEXT")) {
        // make sure it's not an empty text key
        if (peek && peek.value.trim()) {
          this.singleValue();
          continue;
        }
      }

      // multiline field
      if (this.match("TEXT", "COLON", "COLON", "TEXT")) {
        if (peek && peek.value.trim()) {
          this.multilineValue();
          continue;
        }
      }

      // string list item
      if (this.match("STAR", "TEXT")) {
        this.simpleListValue();
        continue;
      }

      // entering an object
      if (this.match("LEFT_BRACE", "TEXT", "RIGHT_BRACE")) {
        this.objectOpen();
        continue;
      }

      if (this.match("LEFT_BRACE", "RIGHT_BRACE")) {
        this.objectClose();
        continue;
      }

      // arrays
      if (this.match("LEFT_BRACKET", "TEXT", "RIGHT_BRACKET")) {
        this.arrayOpen();
        continue;
      }

      if (this.match("LEFT_BRACKET", "RIGHT_BRACKET")) {
        this.arrayClose();
        continue;
      }

      // in case of :end
      if (this.matchValues(":", /^end(?!skip)/i) && this.match("COLON")) {
        this.flushBuffer();
        this.restOfLine();
        continue;
      }

      // handle escaping backslashes
      if (this.match("BACKSLASH")) {
        var [here, next, after] = this.peek(3);
        this.log(`Escaping character ${next.value}`);
        next.type = "ESCAPED";
        this.backBuffer.push(here);
        this.advance();
        continue;
      }

      // accumulate text
      var [peek] = this.peek();
      this.log(`Accumulating possible text ${peek.value.replace(/\n/g, "\\n")}`);
      // freeform arrays can accumulate text as an entry
      if (this.top[ARRAY_TYPE] == "freeform" && peek.value.trim()) {
        this.top.push({ type: "text", value: this.restOfLine().trim() })
      } else {
        this.backBuffer.push(peek);
        this.advance();
      }
    }
    return this.root;
  }

}

module.exports = Parser;