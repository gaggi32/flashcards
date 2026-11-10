//! The OpenRouter key, and the only code that ever sends it anywhere.
//!
//! The key is written once from Settings and stored in the OS credential store
//! (Credential Manager on Windows, Keychain on macOS). No command returns it:
//! the UI sees whether one exists and its last four characters, nothing more.
//! Requests go to one fixed origin; the UI chooses the body, never the URL.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value as Json;

const SERVICE: &str = "ch.404canvas.flashcards";
const ACCOUNT: &str = "openrouter";
const ORIGIN: &str = "https://openrouter.ai/api/v1";
/// Four screenshots of 4 MB, base64-encoded, plus text: well under this.
const MAX_BODY: usize = 24 * 1024 * 1024;

/// Read the credential store once per run, not on every request: on macOS each
/// read of an unsigned app's item can raise a Keychain prompt.
pub struct KeyCache(pub Mutex<Option<Option<String>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub present: bool,
    pub hint: Option<String>,
}

#[derive(Serialize)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

pub fn read_key(cache: &KeyCache) -> Option<String> {
    let mut guard = cache.0.lock().expect("key cache poisoned");
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let key = entry().ok().and_then(|e| e.get_password().ok()).filter(|k| !k.is_empty());
    *guard = Some(key.clone());
    key
}

pub fn hint(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

pub fn status(cache: &KeyCache) -> KeyStatus {
    match read_key(cache) {
        Some(k) => KeyStatus { present: true, hint: Some(hint(&k)) },
        None => KeyStatus { present: false, hint: None },
    }
}

pub fn valid_key(key: &str) -> bool {
    (20..=300).contains(&key.len()) && key.chars().all(|c| c.is_ascii_graphic())
}

pub fn save_key(cache: &KeyCache, key: &str) -> Result<KeyStatus, String> {
    let key = key.trim();
    if !valid_key(key) {
        return Err("That does not look like an OpenRouter key.".into());
    }
    entry()?.set_password(key).map_err(|e| format!("Could not store the key: {e}"))?;
    *cache.0.lock().expect("key cache poisoned") = Some(Some(key.to_string()));
    Ok(status(cache))
}

pub fn clear_key(cache: &KeyCache) -> Result<KeyStatus, String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    *cache.0.lock().expect("key cache poisoned") = Some(None);
    Ok(status(cache))
}

/// Which OpenRouter endpoint a request is for. A closed list, so the UI can
/// never aim the key at any other path.
pub enum Endpoint {
    Chat,
    Key,
    Credits,
}

impl Endpoint {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "chat" => Some(Self::Chat),
            "key" => Some(Self::Key),
            "credits" => Some(Self::Credits),
            _ => None,
        }
    }
}

/// The chat body the UI built, checked before the key is attached.
pub fn check_chat_body(body: &Json, size: usize) -> Result<(), String> {
    if size > MAX_BODY {
        return Err("That request is too large.".into());
    }
    let obj = body.as_object().ok_or("The request must be a JSON object.")?;
    let model = obj.get("model").and_then(Json::as_str).ok_or("The request names no model.")?;
    if !crate::settings::valid_model(model) {
        return Err("That model name is not valid.".into());
    }
    if !obj.get("messages").map_or(false, Json::is_array) {
        return Err("The request has no messages.".into());
    }
    // Streaming would hand back a body this proxy does not read.
    if obj.get("stream").and_then(Json::as_bool) == Some(true) {
        return Err("Streaming is not supported.".into());
    }
    Ok(())
}

pub async fn send(http: &reqwest::Client, key: &str, endpoint: Endpoint, body: Option<Json>) -> Result<Reply, String> {
    let req = match endpoint {
        Endpoint::Chat => {
            let body = body.ok_or("No request body.")?;
            let raw = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
            check_chat_body(&body, raw.len())?;
            http.post(format!("{ORIGIN}/chat/completions"))
                .header("Content-Type", "application/json")
                .body(raw)
                .timeout(Duration::from_secs(90))
        }
        Endpoint::Key => http.get(format!("{ORIGIN}/auth/key")).timeout(Duration::from_secs(10)),
        Endpoint::Credits => http.get(format!("{ORIGIN}/credits")).timeout(Duration::from_secs(10)),
    };
    let res = req
        .bearer_auth(key)
        .header("HTTP-Referer", "https://404canvas.ch/projects/flashcards")
        .header("X-Title", "Flashcards desktop")
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "The model took too long to answer.".to_string() } else { "Could not reach OpenRouter.".to_string() })?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|_| "Could not read OpenRouter's answer.".to_string())?;
    Ok(Reply { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hint_shows_only_the_tail() {
        assert_eq!(hint("sk-or-v1-abcdef1234"), "…1234");
    }

    #[test]
    fn key_shape() {
        assert!(valid_key("sk-or-v1-0123456789abcdef0123"));
        assert!(!valid_key("short"));
        assert!(!valid_key("sk-or-v1 with spaces in the key here"));
    }

    #[test]
    fn chat_body_is_checked() {
        let ok = json!({"model": "google/gemini-3.8-flash", "messages": []});
        assert!(check_chat_body(&ok, 100).is_ok());
        assert!(check_chat_body(&json!({"messages": []}), 10).is_err());
        assert!(check_chat_body(&json!({"model": "x y/z", "messages": []}), 10).is_err());
        assert!(check_chat_body(&json!({"model": "a/b", "messages": [], "stream": true}), 10).is_err());
        assert!(check_chat_body(&ok, MAX_BODY + 1).is_err());
    }

    #[test]
    fn only_known_endpoints() {
        assert!(Endpoint::parse("chat").is_some());
        assert!(Endpoint::parse("../keys").is_none());
    }
}
