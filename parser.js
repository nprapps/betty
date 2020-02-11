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
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  log(...args) {
    if (!this.options.verbose) return;
    console.log(...args);
  }

  advance(amount = 1) {
    var sliced = this.tokens.slice(this.index, this.index + amount);
    this.index += amount;
    return sliced;
  }

  peek(amount = 1) {
    var sliced = this.tokens.slice(this.index, this.index + amount);
    return sliced;
  }

  match(...types) {
    var tokens = this.peek(types.length).map(n => n.type);
    return types.every((t, i) => t == tokens[i]);
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
    var terminal = keypath.pop();
    var branch = object;
    for (var k of keypath) {
      if (!(k in branch)) {
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

  getTarget(key) {
    return key[0] == "." ? this.top : this.root;
  }

  parse() {
    while (this.index < this.tokens.length) {
      // simple value fields
      if (this.match("TEXT", "COLON", "TEXT")) {
        var [key, _, value] = this.advance(3).map(t => t.value);
        var target = this.top;
        if (key in target && this.stack[this.stack.length - 2] instanceof Array) {
          // new list item
          this.pop();
          var list = this.top;
          target = {};
          this.push(target);
          list.push(target);
        }
        this.setPath(target, key, value.trim());
        continue;
      }

      // multiline field
      if (this.match("TEXT", "COLON", "COLON", "TEXT")) {
        var [key] = this.advance(3).map(t => t.value);
        this.log(`Opening multiline value at ${key}`);
        var words = [this.advance().value];
        while (this.index < this.tokens.length) {
          // advance until we see the ending tag
          if (this.match("COLON", "COLON") && this.peek(3)[2].value == key) {
            this.advance(3);
            break;
          }
          var [word] = this.advance();
          words.push(word.value);
        }
        if (key in target && this.stack[this.stack.length - 2] instanceof Array) {
          // new list item
          this.pop();
          var list = this.top;
          target = {};
          this.push(target);
          list.push(target);
        }
        this.setPath(this.top, key, words.join("").trim());
        continue;
      }

      // entering an object
      if (this.match("LEFT_BRACE", "TEXT", "RIGHT_BRACE")) {
        var [_, key] = this.advance(3).map(t => t.value);
        this.log(`Creating object at ${key}`);
        var target = this.getTarget(key);
        var object = {};
        this.setPath(target, key, object);
        this.push(object);
        continue;
      }

      if (this.match("LEFT_BRACE", "RIGHT_BRACE")) {
        this.log(`Closing object tag found`);
        if (!(this.top instanceof Array)) this.pop();
        this.advance(2);
        continue;
      }

      if (this.match("LEFT_BRACKET", "TEXT", "RIGHT_BRACKET")) {
        var [_, key] = this.advance(3).map(t => t.value);
        this.log(`Creating array at ${key}`);
        var target = this.getTarget(key);
        var array = [];
        this.setPath(target, key, array);
        this.push(array);
        var item = {};
        this.push(item);
        array.push(item);
        continue;
      }

      if (this.match("LEFT_BRACKET", "RIGHT_BRACKET")) {
        this.log(`Closing array tag found`);
        // find the closest array
        while (this.top != this.root && !(this.top instanceof Array)) this.pop();
        this.pop();
        this.advance(2);
        continue;
      }

      // ignore blank lines
      if (this.match("TEXT")) {
        var [peek] = this.peek();
        if (!peek.value.trim()) {
          this.advance();
          continue;
        }
      }

      // ignore unmatchable data
      var [unmatched] = this.peek();
      this.log(`Unable to match token starting with ${unmatched.type} | "${unmatched.value.trim()}"`);
      this.advance();
    }
    return this.root;
  }

}

module.exports = Parser;