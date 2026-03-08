package demo

import demo.support.kHelper

interface KRunner {
    fun run(): String
}

open class KRunnerBase {
    fun baseCall(): String = kHelper()
}

class ConcreteKRunner : KRunnerBase(), KRunner {
    override fun run(): String = kHelper()
}

fun bootstrapKotlin(): String {
    val runner = ConcreteKRunner()
    return runner.run()
}
