import pytest
from pydantic import ValidationError

from lifescribe.vault.schemas import VaultSettings, parse_note


def test_vault_settings_defaults() -> None:
    s = VaultSettings(id="settings_default", type="VaultSettings")
    assert s.schema_version == 1
    assert s.privacy_mode is False


def test_vault_settings_id_prefix_required() -> None:
    with pytest.raises(ValidationError, match="settings_"):
        VaultSettings(id="wrong", type="VaultSettings")


def test_vault_settings_roundtrip_via_union() -> None:
    raw = {"id": "settings_default", "type": "VaultSettings", "privacy_mode": True}
    note = parse_note(raw)
    assert isinstance(note, VaultSettings)
    assert note.privacy_mode is True


def test_vault_settings_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        VaultSettings(
            id="settings_default",
            type="VaultSettings",
            bogus=1,  # type: ignore[call-arg]
        )
