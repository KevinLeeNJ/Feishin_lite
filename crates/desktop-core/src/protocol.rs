use serde_json::{json, Value};
use std::time::Instant;

use music_audio_engine::model::{Settings, Track};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Load {
    track: Track,
    start: f64,
    paused: bool,
    settings: Settings,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Seek {
    position: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pause {
    paused: bool,
}

pub const PROTOCOL_VERSION: u64 = 1;
pub const CAPABILITIES: [&str; 3] = ["health", "listOutputDevices", "audio"];

pub struct Session {
    id: String,
    started: Instant,
    ready: bool,
    engine: Option<music_audio_engine::Engine>,
}

impl Session {
    pub fn new(id: String) -> Self {
        Self {
            id,
            started: Instant::now(),
            ready: false,
            engine: None,
        }
    }

    pub fn dispatch(&mut self, request: Value) -> (Value, bool) {
        let request_id = request.get("requestId").and_then(Value::as_str);
        let Some(request_id) = request_id.filter(|id| !id.is_empty() && id.len() <= 128) else {
            return (
                self.error("invalid", "INVALID_REQUEST", "Invalid request ID"),
                false,
            );
        };
        if request.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
            return (
                self.error(
                    request_id,
                    "PROTOCOL_MISMATCH",
                    "Unsupported protocol version",
                ),
                false,
            );
        }
        if !valid_envelope(&request) {
            return (
                self.error(request_id, "INVALID_REQUEST", "Invalid request envelope"),
                false,
            );
        }
        let method = request["method"].as_str().expect("validated method");
        if method != "hello" && !self.ready {
            return (
                self.error(request_id, "NOT_READY", "Handshake required"),
                false,
            );
        }
        let response = match self.execute(method, request.get("params")) {
            Ok(result) => json!({ "protocolVersion": PROTOCOL_VERSION, "sessionId": self.id,
                "requestId": request_id, "result": result }),
            Err((code, message)) => self.error(request_id, code, message),
        };
        (response, method == "shutdown")
    }

    fn execute(
        &mut self,
        method: &str,
        params: Option<&Value>,
    ) -> Result<Value, (&'static str, &'static str)> {
        let result = match method {
            "hello" => {
                self.ready = true;
                json!({ "method": method, "capabilities": CAPABILITIES })
            }
            "health" => {
                json!({ "method": method, "uptimeMs": self.started.elapsed().as_millis() as u64 })
            }
            "listOutputDevices" => output_devices()?,
            "load" | "configure" | "seek" | "setPaused" | "stop" | "snapshot" => {
                return self.audio_command(method, params).map_err(|error| {
                    eprintln!("Audio command failed: {error}");
                    ("AUDIO_ERROR", "Audio command failed")
                });
            }
            "shutdown" => json!({ "method": method }),
            _ => return Err(("UNSUPPORTED_METHOD", "Unsupported method")),
        };
        Ok(result)
    }

    fn audio_command(
        &mut self,
        method: &str,
        params: Option<&Value>,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        if self.engine.is_none() {
            self.engine = Some(music_audio_engine::Engine::new()?);
        }
        let engine = self.engine.as_mut().expect("engine");
        let params = params.cloned().unwrap_or(Value::Null);
        match method {
            "load" => {
                let request: Load = serde_json::from_value(params)?;
                engine.load(
                    request.track,
                    request.start,
                    request.paused,
                    request.settings,
                )?;
            }
            "configure" => engine.configure(serde_json::from_value(params)?)?,
            "seek" => {
                let request: Seek = serde_json::from_value(params)?;
                engine.seek(request.position)?;
            }
            "setPaused" => {
                let request: Pause = serde_json::from_value(params)?;
                engine.pause(request.paused);
            }
            "stop" => engine.stop(),
            "snapshot" => return Ok(json!({ "method": method, "snapshot": engine.snapshot() })),
            _ => unreachable!("validated audio method"),
        }
        Ok(json!({ "method": method }))
    }

    fn error(&self, request_id: &str, code: &str, message: &str) -> Value {
        json!({ "protocolVersion": PROTOCOL_VERSION, "sessionId": self.id,
            "requestId": request_id, "error": { "code": code, "message": message } })
    }
}

fn valid_envelope(request: &Value) -> bool {
    request.as_object().is_some_and(|object| {
        (object.len() == 3 || (object.len() == 4 && object.contains_key("params")))
            && object.contains_key("requestId")
            && object.contains_key("protocolVersion")
            && object.get("method").is_some_and(Value::is_string)
    })
}

fn output_devices() -> Result<Value, (&'static str, &'static str)> {
    let devices = music_audio_engine::platform::list_output_devices().map_err(|error| {
        eprintln!("Output device enumeration failed: {error}");
        ("DEVICE_ERROR", "Output device enumeration failed")
    })?;
    let devices: Vec<Value> = devices.into_iter().map(|device| {
        json!({ "id": device.id, "name": device.name, "isDefault": device.is_default })
    }).collect();
    Ok(json!({ "method": "listOutputDevices", "devices": devices }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str) -> Value {
        json!({ "protocolVersion": 1, "requestId": "test", "method": method })
    }

    #[test]
    fn handshake_and_errors_are_explicit() {
        let mut session = Session::new("session".into());
        assert_eq!(
            session.dispatch(request("health")).0["error"]["code"],
            "NOT_READY"
        );
        let mut incompatible = request("hello");
        incompatible["protocolVersion"] = json!(2);
        assert_eq!(
            session.dispatch(incompatible).0["error"]["code"],
            "PROTOCOL_MISMATCH"
        );
        assert_eq!(
            session.dispatch(request("hello")).0["result"]["capabilities"],
            json!(CAPABILITIES)
        );
        assert_eq!(
            session.dispatch(request("health")).0["sessionId"],
            "session"
        );
        assert_eq!(
            session.dispatch(request("play")).0["error"]["code"],
            "UNSUPPORTED_METHOD"
        );
        let mut extra = request("health");
        extra["path"] = json!("arbitrary");
        assert_eq!(
            session.dispatch(extra).0["error"]["code"],
            "INVALID_REQUEST"
        );
        assert!(session.dispatch(request("shutdown")).1);
    }
}
