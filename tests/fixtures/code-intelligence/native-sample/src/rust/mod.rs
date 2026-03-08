pub mod engine;
use self::engine::run_native;

pub trait NativeRunner {
  fn run(&self);
}

pub fn bootstrap_native() -> &'static str {
  run_native()
}
