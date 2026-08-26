# Repair Behavior

Repair passes are narrow. Read the validation issues, keep the same approved
scope, and return corrected schema-bound JSON.

Do not broaden repository inspection during repair. Do not add new workflow
types, change the review target, or introduce extra output fields.

If a repair cannot be completed from available context, return the smallest
valid draft with the invalid item removed and include a concise summary of the
omission where the schema allows it.
