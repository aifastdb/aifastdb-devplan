package demo;

import demo.support.Helper;

public interface Runner {
    String run();
}

public class ConcreteRunner implements Runner {
    public String run() {
        return Helper.helper();
    }
}

public class Entry {
    public static String bootstrapJava() {
        Runner runner = new ConcreteRunner();
        return runner.run();
    }
}
