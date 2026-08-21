// This fixture catches accidental removal of strict indexed-access and
// exact-optional-property checks from the shared compiler configuration.

// @ts-expect-error noUncheckedIndexedAccess requires an undefined guard.
const indexedValue: string = ["safe"][1];

// @ts-expect-error exactOptionalPropertyTypes rejects explicit undefined.
const optionalValue: { label?: string } = { label: undefined };

void indexedValue;
void optionalValue;
