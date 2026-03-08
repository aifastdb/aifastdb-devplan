from .helpers import PyRunner, py_helper as helper_alias


class ConcretePyRunner(PyRunner):
    def run(self):
        return helper_alias()


def bootstrap_py():
    runner = ConcretePyRunner()
    return runner.run()
