from __future__ import annotations


class VaultError(RuntimeError):
    """Base class for vault-level errors."""


class VaultAlreadyInitializedError(VaultError):
    pass


class VaultNotFoundError(VaultError):
    pass


class SchemaTooNewError(VaultError):
    pass


class HandEditedError(VaultError):
    """Raised internally when a write would clobber a hand-edit."""
