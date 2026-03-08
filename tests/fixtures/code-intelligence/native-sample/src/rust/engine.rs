use super::NativeRunner;

pub struct NativeEngine;

pub const ENGINE_VERSION: &str = "1";

impl NativeRunner for NativeEngine {
  fn run(&self) {
    let _ = run_native();
  }
}

impl NativeEngine {
  pub fn status(&self) -> &'static str {
    run_native()
  }
}

pub fn run_native() -> &'static str {
  "ok"
}
