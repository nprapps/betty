// by default, Betty recognizes several individual characters as tokens for later parsing steps.
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
    // tokens is the final value, buffer accumulates text during tokenization
    var tokens = [];
    var buffer = [];
    // step through the text, one character at a time
    for (var c of text.trim()) {
      // if it matches a known token, push the accumulated buffer followed by the token value
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
    // add any trailing accumulated text at the end of the file
    if (buffer.length) {
      tokens.push({ type: "TEXT", value: buffer.join("") });
    }
    return tokens;
  }
}