from __future__ import annotations

import keyring
import keyring.errors

_SERVICE = "lifescribe-vault"


class SecretStore:
    """Thin wrapper over the OS keyring, scoped to the LifeScribe service name."""

    def get(self, ref: str) -> str | None:
        if not ref:
            raise ValueError("empty secret ref")
        return keyring.get_password(_SERVICE, ref)

    def set(self, ref: str, value: str) -> None:
        if not ref:
            raise ValueError("empty secret ref")
        keyring.set_password(_SERVICE, ref, value)

    def delete(self, ref: str) -> None:
        if not ref:
            raise ValueError("empty secret ref")
        try:
            keyring.delete_password(_SERVICE, ref)
        except keyring.errors.PasswordDeleteError:
            return
