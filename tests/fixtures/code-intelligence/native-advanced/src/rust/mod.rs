pub mod helper;
pub mod service;

use self::helper::helper_call;
use self::service::ServiceRunner;

pub trait Service {
  fn execute(&self) -> &'static str;
}

pub fn bootstrap_service() -> &'static str {
  let runner = ServiceRunner;
  let _ = runner.execute();
  helper_call()
}
