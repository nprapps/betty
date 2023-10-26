
// [TYPE] is used to set metadata on array types
// this lets us use regular JS arrays, but tag them as "freeform" or whatever
var TYPE = Symbol("TYPE");

// [NAME] tags objects with their keys, for easy backtracking of {/name} syntax
var NAME = Symbol("NAME");

// [PARENT] lets us navigate back up the tree
var PARENT = Symbol("PARENT");

var assignSymbol = (a, symbol, value) =>
  Object.defineProperty(a, symbol, {
    value,
    enumerable: false,
    configurable: false
  });

/*
The assembler takes a series of instructions from the parser and uses those to build
an output object. For example, it might use "objectOpen: nested" and "singleValue: key,value"
instructions to output { nested: { key: "value" }}
*/
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
        .map(a => typeof a == "object" ? JSON.stringify(a) : a)
        .join(" ")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
    );
  }

  // stack manipulation methods
  // the assembler maintains a context stack of references for "where" it is
  // in the output object tree - e.g., in a nested object inside an array
  get top() {
    return this.stack[this.stack.length - 1];
  }

  set top(value) {
    this.stack[this.stack.length - 1] = value;
  }

  pushContext(scope) {
    this.stack.push(scope);
  }

  popContext() {
    var scope = this.stack.pop();
    if (!this.stack.length) this.stack = [this.root];
    return scope || this.root;
  }

  // given a key, sets the place in the object where the key should be placed
  getTarget(key) {
    if (key[0] == ".") {
      return this.top;
    }
    this.reset();
    return this.root;
  }

  // on many new keys (outside of lists), jump back to the object root
  reset(scope) {
    this.stack = [this.root];
    if (scope) this.stack.push(scope);
  }

  // turn deep keypaths ("nested.key.string") into a path array
  // as a side effect, moves the + flag to the start of the path
  // this handles `.+key.path` vs `+.key.path`, both of which are
  // (unfortunately) allowed by the spec and in the original tests
  normalizeKeypath(keypath) {
    if (typeof keypath == "string") keypath = keypath.split(".");
    keypath = keypath.filter(Boolean);
    keypath = keypath.map(this.options.onFieldName);
    return keypath;
  }

  // given a keypath, traverse to that location in the output object
  // returns undefined if any step along the keypath fails to exist
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

  // given a keypath, set the value at that final location
  // creates objects along the way for missing keypath segments
  setPath(object, keypath, value) {
    keypath = this.normalizeKeypath(keypath);
    var terminal = keypath.pop().replace(/\+/g, "");
    var branch = object;
    for (var k of keypath) {
      k = k.replace(/\+/g, "");
      if (!k) continue;
      if (!(k in branch) || typeof branch[k] != "object") {
        branch[k] = {};
        assignSymbol(branch[k], PARENT, branch);
        assignSymbol(branch[k], NAME, k);
      }
      branch = branch[k];
    }
    if (typeof value == "string") value = value.trim();
    branch[terminal] = this.options.onValue(value, terminal);
    if (typeof branch[terminal] == "object") {
      assignSymbol(branch[terminal], PARENT, branch);
    }
    return branch;
  }

  // following the instructions, assemble the final object
  assemble(instructions) {
    this.log("Raw instructions stream:");
    instructions.forEach(i => this.log(" ", i));
    
    // pre-process to combine sequential buffered values into a single instruction
    // this initial pass makes it easier to handle blocks of arbitrary text
    var processed = [];
    var interrupts = new Set(["skipped"]);
    var lastValue = null;
    var buffer = [];
    var mergeBuffer = () => buffer.join("").replace(/^\\/m, "");
    this.log("Preprocessing...");
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
            this.log("  Simple item being ignored");
            value = key + value;
          }

        case "buffer":
          this.log("  Merging buffer instructions...");
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
          this.log(`  Value encountered: ${key}`);
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
          this.log(`  Encountered ${type}${key ? ` (${key})` : ""}, clearing buffer`);
          buffer = [];

        default:
          lastValue = null;
          processed.push(instruction);
      }
    }

    // handle leftover garbage in freeform arrays
    var merged = mergeBuffer();
    this.log(`Clearing out dangling buffer items...`);
    if (merged.trim()) {
      processed.push({ type: "buffer", value: merged });
    }

    this.log("Post-process instructions:");
    processed.forEach(i => this.log(" ", i));

    // now we actually process the final instruction stream
    this.log("Assembling result object...")
    for (var instruction of processed) {
      var { type, key, value } = instruction;
      this.log(`  ${[type,key,value].filter(d => d).join("/")}`);
      // each instruction has a matching method
      this[type](key, value);
    }
    return this.root;
  }

  // methods for adding values to arbitrary targets (objects or arrays)
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
        if (typeof value == "string") value = value.trim();
        key = key.replace(/^[\.+]*/, "");
        var obj = { type: key, value };
        assignSymbol(obj, PARENT, target);
        target.push(obj);
        break;

      case "simple":
        // simple arrays can't contain keyed values
        break;

      default:
        if (!target[TYPE]) assignSymbol(target, TYPE, "standard");
        // add to the last object in the array
        var last = target[target.length - 1];
        if (!last || this.getPath(last, key)) {
          last = {};
          target.push(last);
          assignSymbol(last, PARENT, target);
        }
        if (typeof value == "string") value = value.trim();
        this.setPath(last, key, value);
    }
  }

  // methods to handle each instruction
  // there are relatively few of these, because after parsing, an ArchieML
  // document basically just enters object/arrays and adds properties to them
  value(key, value) {
    var target = this.top;
    value = value.trim();

    if (target instanceof Array) {
      switch (target[TYPE]) {
        case "simple":
          // key value pairs are ignored
          break;

        case "freeform":
          // you can't add non-dot composite objects to a freeform array
          // so we'll exit the array and re-call this
          if (typeof value == "object" && !key.match(/^\+?\./)) {
            this.closeArray();
            return this.value(key, value);
          }
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
        assignSymbol(this.top, TYPE, "simple");
        this.top.push(value.trim());
      }

      if (this.top[TYPE] == "freeform") {
        var obj = { type: "text", value: (key + value).trim() };
        assignSymbol(obj, PARENT, this.top);
        this.top.push(obj);
      }
    }
  }

  object(key) {
    var target = this.getTarget(key);
    var object = this.getPath(target, key);
    var path = this.normalizeKeypath(key);
    if (typeof object != "object") {
      object = {};
      var name = path.at(-1);
      assignSymbol(object, NAME, name);
    }
    this.append(target, key, object);
    this.pushContext(object);
  }

  closeObject(key) {
    // remove the current top scope
    var top = this.popContext();
    // navigate via parent up to the named object and push it onto the stack
    if (key) {
      while (top != this.root && top[NAME] != key) {
        top = top[PARENT];
      }
      this.pushContext(top[PARENT]);
    }
  }

  array(key) {
    var array = [];
    var target = this.getTarget(key);
    var path = this.normalizeKeypath(key);
    var name = path.at(-1);
    var [head] = path;
    assignSymbol(array, NAME, name);
    if (head[0] == "+") {
      assignSymbol(array, TYPE, "freeform");
    }
    this.append(target, key, array);
    this.pushContext(array);
  }

  closeArray(key) {
    if (key) {
       // remove the current top scope
      var top = this.popContext();
      // navigate via parent up to the named object and push it onto the stack
      if (key) {
        while (top != this.root && top[NAME] != key) {
          top = top[PARENT];
        }
        this.pushContext(top[PARENT]);
      }
    } else {
      while (!(this.top instanceof Array) && this.top != this.root) this.popContext();
      if (this.top instanceof Array) this.popContext();
    }
  }

  buffer(key, value) {
    var target = this.top;
    if (target[TYPE] == "freeform") {
      var split = value.split("\n").filter(s => s.trim());
      split.forEach(v => target.push({ type: "text", value: v.trim() }));
    }
  }

  // no-op instructions
  // flush and skip are technically handled during pre-processing
  flush() {}
  skipped() {}
}

module.exports = Assembler;
