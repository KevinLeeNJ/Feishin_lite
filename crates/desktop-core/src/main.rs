mod frame;
mod protocol;

use std::io;
use std::time::{SystemTime, UNIX_EPOCH};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let created = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let mut session = protocol::Session::new(format!("{}-{created}", std::process::id()));
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    while let Some(body) = frame::read_frame(&mut input)? {
        let request = serde_json::from_slice(&body)?;
        let (response, shutdown) = session.dispatch(request);
        frame::write_frame(&mut output, &serde_json::to_vec(&response)?)?;
        if shutdown {
            break;
        }
    }
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Backend stopped: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
