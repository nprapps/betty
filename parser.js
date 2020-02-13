var identity = c => c;

var defaultOptions = {
  verbose: false,
  onFieldName: identity,
  onValue: identity,
  allowDuplicateKeys: true
}

const OBJECT = 1;
const MULTILINE = 2;
const LIST = 3;

class Parser {
  constructor(tokenList, options = {}) {
    this.tokens = tokenList;
    this.options = Object.assign({}, defaultOptions, options);
    this.index = 0;
    this.mode = OBJECT;
    this.root = {};
    this.stack = [this.root];
    this.lastKey = null;
    this.backBuffer = [];
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  log(...args) {
    if (!this.options.verbose) return;
    console.log(args.join(" ").replace(/\n/g, "\\n"));
  }

  advance(amount = 1) {
    var sliced = this.tokens.slice(this.index, this.index + amount);
    this.index += amount;
    return sliced;
  }

  advanceThroughValue(v) {
    var acc = [];
    var [next] = this.peek();
    while (next && next.value != v) {
      acc.push(next);
      this.advance();
      [next] = this.peek();
    }
    // absorb the value we found
    var [found] = this.advance();
    if (found) acc.push(found);
    return acc;
  }

  restOfLine() {
    return this.advanceThroughValue("\n").map(t => t.value).join("");
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
    var tokens = this.peek(values.length).map(n => n.value);
    return values.every((v, i) => v == tokens[i]);
  }

  matchRegex(...values) {
    var tokens = this.peek(values.length).map(n => n.value);
    return values.every((v, i) => tokens[i].match(v));
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

  addToArray(target, key, value) {
    if (target.type == "freeform") {
      key = key.replace(/^[\.+]*/, "");
      target.push({ type: key, value });
    } else {
      // add to the last object in the array
      var last = target[target.length - 1];
      if (!last || this.getPath(last, key)) {
        last = {};
        target.push(last);
      }
      this.setPath(last, key, value);
    }
  }

  setArrayType(array, value) {
    Object.defineProperty(array, "type", { value, enumerable: false, configurable: true });
  }

  isRelative(key) {
    return key[0] == ".";
  }

  getTarget(key) {
    if (this.isRelative(key)) {
      return this.top;
    }
    this.reset();
    return this.root;
  }

  skipCommand() {
    this.log(`Encountered skip tag`);
    this.advance(2);
    this.remember(-1);
    while (!this.matchRegex(/^:$/, /^endskip/i) && (this.index < this.tokens.length - 2)) {
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
    if (this.top instanceof Array) {
      // simple arrays can't contain keyed values
      if (this.top.type == "simple") {
        var combined = [key.value, value].join(":");
        this.log(`Accumulating line inside of simple list "${combined}"`)
        this.backBuffer.push({ type: "TEXT", value: combined });
        return;
      } else {
        if (!this.top.type) this.setArrayType(this.top, "standard");
        this.addToArray(this.top, k, value.trim());
      }
    } else {
      this.setPath(this.top, k, value.trim());
    }
    this.log(`Encountered key value for ${k}`);
    this.remember(k);
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
    var value = words.join("").trim();
    if (this.top instanceof Array) {
      // simple arrays can't contain keyed values
      if (this.top.simple) {
        this.pop();
        this.setPath(this.top, key, value);
      } else {
        this.addToArray(this.top, key, value);
      }
    } else {
      this.setPath(this.top, key, value);
    }
  }

  simpleListValue() {
    // pass the star
    var [star] = this.advance();
    var value = this.restOfLine();
    if (this.top instanceof Array && !this.top.type || this.top.type == "simple") {
      this.log(`Assigning simple list value ${value.trim()}`);
      this.remember(null);
      this.top.push(value.trim());
      this.setArrayType(this.top, "simple");
    } else if (this.top.type == "freeform") {
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
    var target = this.top;
    if (!this.isRelative(key)) {
      this.reset();
      target = this.root;
    }
    var object = this.getPath(target, key);
    if (typeof object != "object") {
      object = {};
    }
    if (target instanceof Array) {
      this.addToArray(target, key, object);
    } else {
      this.setPath(target, key, object);
    }
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
    var target = this.top;
    if (!this.isRelative(key)) {
      target = this.root;
      this.reset();
    }
    var array = [];
    var last = this.normalizeKeypath(key).pop();
    if (last[0] == "+") {
      this.log(`Setting array as freeform: ${last}`)
      this.setArrayType(array, "freeform");
    }
    if (target instanceof Array) {
      this.addToArray(target, key, array);
    } else {
      this.setPath(target, key, array);
    }
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
    if (target instanceof Array && target.type == "simple" && !this.lastKey) {
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
      if (this.matchRegex(/^:$/, /^ignore/i) && this.match("COLON")) {
        break;
      }

      // skip takes precedence
      if (this.matchRegex(/^:$/, /^skip/i) && this.match("COLON")) {
        this.skipCommand();
        continue;
      }


      // simple value fields
      if (this.match("TEXT", "COLON", "TEXT")) {
        // make sure it's not an empty text key
        if (peek && peek.value.trim() && (!previous || previous.type != "BACKSLASH")) {
          this.singleValue();
          continue;
        }
      }

      // multiline field
      if (this.match("TEXT", "COLON", "COLON", "TEXT")) {
        if (peek && peek.value.trim() && (!previous || previous.type != "BACKSLASH")) {
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
      if (this.matchRegex(/^:$/, /^end(?!skip)/i) && this.match("COLON")) {
        this.flushBuffer();
        this.restOfLine();
        continue;
      }

      // handle escaping backslashes
      if (this.match("BACKSLASH")) {
        var [here, next, after] = this.peek(3);
        this.log(`Escaping character ${next.value}`);
        next.type = "TEXT";
        this.backBuffer.push(here);
        this.advance();
        continue;
      }

      // accumulate text
      var [peek] = this.peek();
      this.log(`Accumulating possible text ${peek.value.replace(/\n/g, "\\n")}`);
      // freeform arrays can accumulate text as an entry
      if (this.top.type == "freeform" && peek.value.trim()) {
        this.top.push({ type: "text", value: this.restOfLine().trim() })
      } else {
        this.backBuffer.push(peek);
        this.advance();
      }

      // throw away unmatched value
      // var [unmatched] = this.advance();
      // this.log(`Unmatched value ${unmatched.type} | ${unmatched.value}`);
    }
    return this.root;
  }

}

module.exports = Parser;