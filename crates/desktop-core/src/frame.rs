use std::io::{self, Read, Write};

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0; 4];
    if reader.read(&mut header[..1])? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut header[1..])?;
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok(Some(body))
}

pub fn write_frame(writer: &mut impl Write, body: &[u8]) -> io::Result<()> {
    if body.is_empty() || body.len() > MAX_FRAME_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    writer.write_all(&(body.len() as u32).to_be_bytes())?;
    writer.write_all(body)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn frames_preserve_boundaries_and_reject_truncation() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, b"first").unwrap();
        write_frame(&mut bytes, b"second").unwrap();
        let mut input = Cursor::new(bytes);
        assert_eq!(read_frame(&mut input).unwrap().unwrap(), b"first");
        assert_eq!(read_frame(&mut input).unwrap().unwrap(), b"second");
        assert!(read_frame(&mut input).unwrap().is_none());
        for bytes in [
            vec![0, 0],
            vec![0, 0, 0, 2, 1],
            vec![0, 0, 0, 0],
            vec![0, 16, 0, 1],
        ] {
            assert!(read_frame(&mut Cursor::new(bytes)).is_err());
        }
    }
}
