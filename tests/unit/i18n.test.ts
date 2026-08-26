import assert from "node:assert/strict";
import test from "node:test";
import {
  detectLanguage,
  getMessages,
  isRtlLanguage,
  LANGUAGE_OPTIONS,
  resolveLanguagePreference,
} from "../../app/components/i18n";

test("the interface ships complete message packs for 30 languages", () => {
  assert.equal(LANGUAGE_OPTIONS.length, 30);
  const englishKeys = Object.keys(getMessages("en")).sort();
  for (const { code } of LANGUAGE_OPTIONS) {
    assert.deepEqual(Object.keys(getMessages(code)).sort(), englishKeys);
    assert.ok(getMessages(code).engine.length > 0);
  }
});

test("language detection follows the system preference order and known aliases", () => {
  assert.equal(detectLanguage(["xx-ZZ", "pt-BR", "en-US"]), "pt");
  assert.equal(detectLanguage(["zh-Hant-TW"]), "zh");
  assert.equal(detectLanguage(["tl-PH"]), "fil");
  assert.equal(detectLanguage(["iw-IL"]), "he");
  assert.equal(detectLanguage([]), "en");
  assert.equal(isRtlLanguage("ar"), true);
  assert.equal(isRtlLanguage("es"), false);
});

test("system language is the default unless the user made a current manual choice", () => {
  assert.equal(resolveLanguagePreference(null, ["ru-RU", "en-US"]), "ru");
  assert.equal(resolveLanguagePreference(undefined, ["ar-EG"]), "ar");
  assert.equal(resolveLanguagePreference("es", ["ru-RU"]), "es");
  assert.equal(resolveLanguagePreference("legacy-or-invalid", ["de-DE"]), "de");
});
