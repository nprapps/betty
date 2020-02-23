var TYPE = Symbol();

var assignType = (a, value) =>
  Object.defineProperty(a, TYPE, {
    value,
    enumerable: false,
    configurable: false
  });

class Assembler {
  constructor(options) {
    this.options = options;
    this.root = {};
    this.stack = [this.root];
    this.instructions = [];
    this.index = 0;
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

  get top() {
    return this.stack[this.stack.length - 1];
  }

  pushContext(scope) {
    this.stack.push(scope);
  }

  popContext() {
    var scope = this.stack.pop();
    if (!this.stack.length) this.stack = [this.root];
    return scope;
  }

  getTarget(key) {
    if (key[0] == ".") {
      return this.top;
    }
    this.reset();
    return this.root;
  }

  reset(scope) {
    this.stack = [this.root];
    if (scope) this.stack.push(scope);
  }

  normalizeKeypath(keypath) {
    if (typeof keypath == "string") keypath = keypath.split(".");
    keypath = keypath.filter(Boolean);
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
    if (typeof value == "string") value = value.trim();
    branch[terminal] = this.options.onValue(value, terminal);
    return branch;
  }

  assemble(instructions) {
    if (this.options.verbose) {
      this.log("Raw instructions stream");
      instructions.forEach(i => console.log(i));
    }
    
    // pre-process to combine buffered values
    var processed = [];
    var interrupts = new Set(["skipped"]);
    var lastValue = null;
    var buffer = [];
    var mergeBuffer = function() {
      var merged = buffer.join("");
      // only remove backslashes at the start of lines
      // it's dumb but whatever
      merged = merged.replace(/^\\/m, "");
      return merged;
    };
    for (var i = 0; i < instructions.length; i++) {
      var instruction = instructions[i];
      var { type, key, value } = instruction;
      switch (type) {
        case "simple":
          // simple buffers if any other value has been set
          if (!lastValue || lastValue.type == "simple") {
            buffer = [];
            processed.push(instruction);
            lastValue = instruction;
            break;
          } else {
            this.log("Simple item being ignored");
            value = key + value;
          }

        case "buffer":
          this.log("Merging buffer instructions...");
          buffer.push(value);
          var next = instructions[i + 1];
          while (next && next.type == "buffer") {
            i++;
            buffer.push(next.value);
            next = instructions[i + 1];
          }
          break;

        case "value":
          if (lastValue && lastValue.type == "simple") {
            // buffer this inside of a simple value
            buffer.push(key + ":" + value);
            break;
          }
          this.log(`Value encountered: ${key}`);
          lastValue = instruction;
          var merged = mergeBuffer();
          if (merged.trim()) {
            processed.push({ type: "buffer", value: merged });
          }
          processed.push(instruction);
          buffer = [];
          break;

        case "flush":
          if (buffer.length) {
            var merged = mergeBuffer();
            if (lastValue && merged.trim()) {
              lastValue.value += merged;
            } else {
              processed.push({ type: "buffer", value: merged });
            }
          }
          buffer = [];
          break;

        case "object":
        case "array":
        case "closeObject":
        case "closeArray":
          var merged = mergeBuffer();
          if (merged.trim()) {
            processed.push({ type: "buffer", value: merged });
          }
          this.log(`Encountered ${type} (${key}), clearing buffer`);
          buffer = [];

        default:
          lastValue = null;
          processed.push(instruction);
      }
    }

    // handle leftover garbage in freeform arrays
    var merged = mergeBuffer();
    this.log(`Clearing out dangling buffer items`);
    if (merged.trim()) {
      processed.push({ type: "buffer", value: merged });
    }

    if (this.options.verbose) {
      this.log("Post-process instructions");
      processed.forEach(i => console.log(i));
    }

    for (var instruction of processed) {
      var { type, key, value } = instruction;
      this.log(`> Assembling: ${type}/${key}/${value}`);
      this[type](key, value);
    }
    return this.root;
  }

  append(target, key, value) {
    if (target instanceof Array) {
      return this.addToArray(target, key, value);
    } else {
      if (typeof value == "string") value = value.trim();
      this.setPath(target, key, value);
    }
  }

  // returns true if the addition was ignored
  addToArray(target, key, value) {
    switch (target[TYPE]) {
      case "freeform":
        key = key.replace(/^[\.+]*/, "");
        if (typeof value == "string") value = value.trim();
        target.push({ type: key, value });
        break;

      case "simple":
        // simple arrays can't contain keyed values
        break;

      default:
        if (!target[TYPE]) assignType(target, "standard");
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

  value(key, value) {
    var target = this.top;
    value = value.trim();

    if (target instanceof Array) {
      switch (target[TYPE]) {
        case "simple":
          // key value pairs are ignored
          break;

        case "freeform":
          target.push({ type: key, value });
          break;

        default:
          this.append(target, key, value);
      }
    } else {
      this.append(target, key, value);
    }
  }

  simple(key, value) {
    if (this.top instanceof Array) {
      if (this.top[TYPE] == "simple" || !this.top[TYPE]) {
        assignType(this.top, "simple");
        this.top.push(value.trim());
      }

      if (this.top[TYPE] == "freeform") {
        this.top.push({ type: "text", value: (key + value).trim() });
      }
    }
  }

  object(key) {
    var target = this.getTarget(key);
    var object = this.getPath(target, key);
    if (typeof object != "object") {
      object = {};
    }
    this.append(target, key, object);
    this.pushContext(object);
  }

  closeObject() {
    this.popContext();
  }

  array(key) {
    var array = [];
    var target = this.getTarget(key);
    var array = [];
    var last = this.normalizeKeypath(key).pop();
    if (last[0] == "+") {
      assignType(array, "freeform");
    }
    this.append(target, key, array);
    this.pushContext(array);
  }

  closeArray() {
    while (!(this.top instanceof Array)) this.popContext();
    this.popContext();
  }

  buffer(key, value) {
    var target = this.top;
    if (target[TYPE] == "freeform") {
      var split = value.split("\n").filter(s => s.trim());
      split.forEach(v => target.push({ type: "text", value: v.trim() }));
    }
  }

  flush() {}

  skipped() {}
}

module.exports = Assembler;
