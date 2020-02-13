var quick = {
  "{": "LEFT_BRACE",
  "}": "RIGHT_BRACE",
  "[": "LEFT_BRACKET",
  "]": "RIGHT_BRACKET",
  ":": "COLON",
  "*": "STAR",
  "\n": "TEXT",
  "\\": "BACKSLASH"
}

module.exports = {
  tokenize(text) {
    var tokens = [];
    var buffer = [];
    for (var c of text.trim()) {
      if (c in quick) {
        if (buffer.length) {
          tokens.push({ type: "TEXT", value: buffer.join("") });
          buffer = [];
        }
        tokens.push({ type: quick[c], value: c });
      } else {
        buffer.push(c)
      }
    }
    if (buffer.length) {
      tokens.push({ type: "TEXT", value: buffer.join("") });
    }
    return tokens;
  }
}