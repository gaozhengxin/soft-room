# Optional persistent identity

Soft Room can continue with its existing temporary Waku identity or attach encrypted portable state to an AT Protocol account. AT Protocol is not part of room authentication and its account identifier is never included in Waku messages.

## Records

- `uk.wakukusmartrecipe.soft.identity/self` contains an AES-256-GCM envelope for schema version 1 and the Waku private identity.
- Each `uk.wakukusmartrecipe.soft.room/<random-rkey>` record contains one independently encrypted schema version 1 room capability and its minimal local metadata.
- `uk.wakukusmartrecipe.soft.recovery/self` contains the MasterKey wrapped by the random secret held in the user's recovery file.

Room record keys are random, so the room ID is also inside the ciphertext. Records are written with unknown-Lexicon validation disabled until the app Lexicons are published. The schemas in `lexicons/` document the public envelope; they deliberately do not describe plaintext state.

## Local key handling

Each account gets a random 256-bit AES-GCM MasterKey. Only a non-extractable `CryptoKey` is retained in IndexedDB. During creation, the raw key exists briefly in memory so it can be wrapped by a separate random 256-bit recovery secret. The recovery secret is placed in a versioned recovery file for the user; it is never sent to the PDS. The existing active Waku session remains in session storage for compatibility with the rest of the app. App Passwords are used only for login and are never stored.

The PDS can still observe that an account uses the Soft Room collections, the number and approximate size of records, and update timestamps. Random room record keys prevent direct room-ID/topic correlation, but they do not hide this metadata.

Browser storage cannot provide the hardware-backed protection available to a native keychain. A script running in the same origin could ask the non-extractable key to decrypt data. Native keychain integration remains a future hardening step.

## Cross-device recovery

The MasterKey is intentionally not derived from an account password and is never uploaded in plaintext. A new device authenticates the AT Protocol account, reads the public encrypted recovery envelope, and locally unwraps the MasterKey using the selected recovery file. It can then decrypt the same Waku private key and room records. The recovery file is account-bound and checksum protected; possessing it together with read access to the public repo is sufficient to recover all Soft Room capabilities, so the UI requires an explicit download and displays a strong warning.

Identities created before recovery files existed are migrated on their original device the next time the user signs in with the same account. Migration rotates the MasterKey, rewrites encrypted identity and room records, and produces the recovery file. Until then, a new device cannot recover that legacy identity.

OAuth, account creation, PDS migration, DID self-custody, DID rotation, and QR device transfer are deferred. The normal UI defaults to `https://bsky.social`; a custom HTTPS PDS is available only under Advanced Settings.
