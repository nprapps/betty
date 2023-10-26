Betty
=====

A more specific dialect of `ArchieML <https://archieml.org>`_. While working with editors and reporters, we often found that the format, while "forgiving," can be brittle (especially when combined with CommonMark content). In particular, multiline keys are prone to breaking (either containing no content, or enthusiastically eating the next object in a list). As a result, Betty makes the following changes:

* Lists will start a new item when they see any redefined key, not just the first key in an object.
* Multiline fields are now less ambiguous: open them with  ``key::`` and close with ``::key``.
* If you've opened multiple levels of object, you can jump back out to a specific level by key: ``{/name}`` will close ``{name}``. Note that slash must be flush with the opening brace in this syntax: ``{ /name }`` will not close an object.
* Similarly, you can exit out of a specific named list with ``[/key]`` instead of needing to close individual levels with repeated ``[]`` lines
* You can provide options for behavior:

  * ``verbose`` - set this to be overwhelmed with logging messages
  * ``onFieldName`` - provide a callback that accepts a string key for mutation and returns the transformed version. Useful for lower-casing keys when Google Docs tries to capitalize them.
  * ``onValue`` - provide a callback that accepts the value and field name, and returns the actual value to add to the object. Useful for automatically casting dates, booleans, and numbers.

The module exports a single object with a ``parse()`` method, which accepts the text you want to parse and the options object.

When adding new features or altering the parser, it's useful to make sure that you haven't broken anything. ``npm test`` will run a check against the files from the original specification repo where applicable, as well as a document containing the syntax extensions defined above. Although Betty is not fully-compliant with the ArchieML spec, it should handle existing content reliably.

Behind the scenes
-----------------

When you call ``parse()``, Betty actually runs through three stages before producing a final JSON object.

1. A tokenizer breaks the text into a stream of tagged chunks, consisting of either possible syntax characters (such as ``{``,  ``}``, and ``:``) or text.
2. The parser takes the stream of tokens and turns them into higher level instructions for things like "enter an array," "set a value at ``key.path``," or "buffer this text."
3. The assembler takes those instructions, pre-processes them (merging buffered strings together), then runs through the final stream of operations to actually assemble the object.

This is much more complex than the baseline ArchieML module. I personally think it's easier this way to reason about the logic for some of the language's "quirks," such as the inconsistent behavior of ``:end`` or ``\`` as an escape. Your mileage may vary.
