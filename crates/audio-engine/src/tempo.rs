use ssstretch::Stretch;

pub struct Tempo {
    stretch: Stretch,
    speed: f64,
    remainder: f64,
    skip: usize,
    wanted: f64,
    emitted: usize,
}

impl Tempo {
    pub fn new(rate: u32, speed: f64) -> Self {
        let mut stretch = Stretch::new();
        stretch.preset_default(2, rate as f32);
        let skip = (f64::from(stretch.input_latency()) / speed).round() as usize
            + stretch.output_latency() as usize;
        Self {
            stretch,
            speed,
            remainder: 0.0,
            skip,
            wanted: 0.0,
            emitted: 0,
        }
    }

    pub fn process(&mut self, frames: &[[f32; 2]]) -> Vec<[f32; 2]> {
        self.wanted += frames.len() as f64 / self.speed;
        let target = frames.len() as f64 / self.speed + self.remainder;
        let length = target.floor() as usize;
        self.remainder = target - length as f64;
        let input = [
            frames.iter().map(|f| f[0]).collect::<Vec<_>>(),
            frames.iter().map(|f| f[1]).collect(),
        ];
        let mut output = vec![vec![0.0; length]; 2];
        self.stretch
            .process_vec(&input, frames.len() as i32, &mut output, length as i32);
        self.take_output(&output, false)
    }

    pub fn finish(&mut self) -> Vec<[f32; 2]> {
        let length = self.wanted.round() as usize - self.emitted + self.skip;
        let mut output = vec![vec![0.0; length]; 2];
        let mut pointers = [output[0].as_mut_ptr(), output[1].as_mut_ptr()];
        // Both planar buffers contain exactly `length` writable samples and remain alive.
        unsafe {
            self.stretch.flush(&mut pointers, length as i32);
        }
        self.take_output(&output, true)
    }

    fn take_output(&mut self, output: &[Vec<f32>], finish: bool) -> Vec<[f32; 2]> {
        let mut frames = Vec::new();
        for index in 0..output[0].len() {
            if self.skip > 0 {
                self.skip -= 1;
                continue;
            }
            if finish && self.emitted >= self.wanted.round() as usize {
                break;
            }
            frames.push([output[0][index], output[1][index]]);
            self.emitted += 1;
        }
        frames
    }
}
