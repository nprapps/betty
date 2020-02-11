Betty
=====

A more careful parser for `ArchieML <https://archieml.org>`_. Differs from the mainline parser and format in a few ways:

* Lists will start a new item when they see any redefined key, not just the first key in an object.
* Multiline fields are now less ambiguous: open them with  ``key::`` and close with ``::key``.
* (not yet implemented) Fields can be cast to a specific type using ``field<type>: value`` syntax
* Freeform arrays are not yet supported.

Example code for use is located in ``test.js``. Generally, you can simply call the module's ``parse()`` method the same as you would the base ArchieML-JS library. However, we also support passing in an object with parsing options as the second argument:

* ``verbose``: set to ``true`` to see error and debugging messages
* ``onFieldName``: provide a function to change or mutate the field name before it's used to access or update the output object.
* ``onValue``: provide a function with a signature of ``callback(value, fieldName)`` to allow modifying values before they're placed on the output object.