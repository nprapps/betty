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

  advanceUntilValue(v) {
    var acc = [];
    var [next] = this.peek();
    while (next && next.value != v) {
      acc.push(this.advance()[0]);
      [next] = this.peek();
    }
    return acc;
  }

  restOfLine() {
    return this.advanceUntilValue("\n").map(t => t.value).join("").trim();
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
    var terminal = keypath.pop().replace(/\+/g, "");
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

  reset(object) {
    this.stack = [this.root];
    if (object) this.push(object);
  }

  addToArray(target, key, value) {
    if (target.freeform) {
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

  parse() {
    while (this.index < this.tokens.length) {

      // simple value fields
      if (this.match("TEXT", "COLON", "TEXT")) {
        var [key] = this.advance(2).map(t => t.value);
        // get values up through the line break
        var value = this.restOfLine();
        var target = this.top;
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
        continue;
      }

      // multiline field
      if (this.match("TEXT", "COLON", "COLON", "TEXT")) {
        var [key] = this.advance(3).map(t => t.value.trim());
        this.log(`Opening multiline value at ${key}`);
        var words = [this.advance().value];
        while (this.index < this.tokens.length) {
          // advance until we see the ending tag
          var third = this.peek(3)[2].value.trim();
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
        continue;
      }

      // string list item
      if (this.match("STAR", "TEXT")) {
        // pass the star
        this.advance();
        var value = this.restOfLine();
        if (this.top instanceof Array) {
          this.top.push(value);
          Object.defineProperty(this.top, "simple", { value: true, enumerable: false });
        }
      }

      // entering an object
      if (this.match("LEFT_BRACE", "TEXT", "RIGHT_BRACE")) {
        var [_, key] = this.advance(3).map(t => t.value);
        this.log(`Creating object at ${key}`);
        // by default, creates a new object at the root
        var object = {};
        var target = this.top;
        if (!this.isRelative(key)) {
          this.reset();
          target = this.root;
        }
        if (target instanceof Array) {
          this.addToArray(target, key, object);
        } else {
          this.setPath(target, key, object);
        }
        this.push(object);
        continue;
      }

      if (this.match("LEFT_BRACE", "RIGHT_BRACE")) {
        this.log(`Closing object tag found`);
        if (!(this.top instanceof Array)) this.pop();
        this.advance(2);
        continue;
      }

      // arrays
      if (this.match("LEFT_BRACKET", "TEXT", "RIGHT_BRACKET")) {
        var [_, key] = this.advance(3).map(t => t.value);
        this.log(`Creating array at ${key}`);
        var target = this.top;
        if (!this.isRelative(key)) {
          target = this.root;
          this.reset();
        }
        var array = [];
        if (target instanceof Array) {
          this.addToArray(target, key, array);
        } else {
          this.setPath(target, key, array);
        }
        this.push(array);
        var last = this.normalizeKeypath(key).pop();
        if (last[0] == "+") {
          Object.defineProperty(array, "freeform", { value: true, enumerable: false });
        }
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
        } else {
          // freeform arrays can accumulate text
          if (this.top.freeform) {
            var value = 
            this.top.push({ type: "text", value: this.restOfLine() })
          }
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