use crate::rust::Service;
use crate::rust::helper::helper_call;

pub struct ServiceRunner;

impl Service for ServiceRunner {
  fn execute(&self) -> &'static str {
    helper_call()
  }
}
