package com.aidevassistant.architecture;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

class ArchitectureTest {

    private static final JavaClasses PRODUCTION_CLASSES = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.aidevassistant");

    @Test
    void domainMustNotDependOnFrameworksOrInfrastructure() {
        noClasses()
                .that().resideInAPackage("..domain..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "org.springframework..",
                        "org.mongodb..",
                        "com.mongodb..",
                        "..application..",
                        "..adapter..")
                .allowEmptyShould(true)
                .check(PRODUCTION_CLASSES);
    }

    @Test
    void inboundAdaptersMustNotDependOnOutboundPortsOrAdapters() {
        noClasses()
                .that().resideInAPackage("..adapter.in..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "..application.port.out..",
                        "..adapter.out..")
                .allowEmptyShould(true)
                .check(PRODUCTION_CLASSES);
    }

    @Test
    void localEmbeddingAdapterMustNotDependOnNetworkApis() {
        noClasses()
                .that().resideInAPackage("..adapter.out.onnx..")
                .should().dependOnClassesThat().resideInAnyPackage(
                        "java.net..",
                        "java.net.http..")
                .allowEmptyShould(true)
                .check(PRODUCTION_CLASSES);
    }
}
