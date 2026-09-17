# Optional persistent identity

Soft Room can continue with its existing temporary Waku identity or attach encrypted portable state to an AT Protocol account. AT Protocol is not part of room authentication and its account identifier is never included in Waku messages.

## Records

- `uk.wakukusmartrecipe.soft.identity/self` contains an AES-256-GCM envelope for schema version 1 and the Waku private identity.
- Each `uk.wakukusmartrecipe.soft.room/<random-rkey>` record contains one independently encrypted schema version 1 room capability and its minimal local metadata.

Room record keys are random, so the room ID is also inside the ciphertext. Records are written with unknown-Lexicon validation disabled until the app Lexicons are published. The schemas in `lexicons/` document the public envelope; they deliberately do not describe plaintext state.

## Local key handling

Each account gets a random, non-extractable 256-bit AES-GCM `CryptoKey`. The key and a mirror of encrypted records are stored in IndexedDB. The existing active Waku session remains in session storage for compatibility with the rest of the app. App Passwords are used only for login and are never stored.

The PDS can still observe that an account uses the Soft Room collections, the number and approximate size of records, and update timestamps. Random room record keys prevent direct room-ID/topic correlation, but they do not hide this metadata.

Browser storage cannot provide the hardware-backed protection available to a native keychain. A script running in the same origin could ask the non-extractable key to decrypt data. Native keychain integration remains a future hardening step.

## Recovery limitation

The MasterKey is intentionally not derived from an account password and is never uploaded to the PDS. This release does not invent a recovery-code or device-transfer format. Therefore a second device can discover that encrypted state exists but cannot decrypt it until a recovery-key export/import flow is designed. The record and key-store abstractions support adding that flow later without changing Waku identity or room records.

OAuth, account creation, PDS migration, DID self-custody and DID rotation are also deferred. The normal UI defaults to `https://bsky.social`; a custom HTTPS PDS is available only under Advanced Settings.
