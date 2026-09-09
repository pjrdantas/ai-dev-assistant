package com.aidevassistant.prompt.domain;

import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.Prompt;
import com.aidevassistant.prompt.domain.model.PromptHash;
import com.aidevassistant.prompt.domain.policy.ConservativePromptNormalizer;
import com.aidevassistant.prompt.domain.policy.Sha256PromptHasher;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PromptDomainTest {

    private final ConservativePromptNormalizer normalizer = new ConservativePromptNormalizer();
    private final Sha256PromptHasher hasher = new Sha256PromptHasher();

    @Test
    void promptPreservesOriginalContent() {
        Prompt prompt = new Prompt("  Keep MyClass and punctuation();  ");

        assertEquals("  Keep MyClass and punctuation();  ", prompt.value());
    }

    @Test
    void promptRejectsBlankContent() {
        assertThrows(IllegalArgumentException.class, () -> new Prompt(" \n\t "));
    }

    @Test
    void normalizationRemovesExternalWhitespaceAndUsesLf() {
        NormalizedPrompt result = normalizer.normalize(new Prompt("  First line\r\nSecond line\r  "));

        assertEquals("First line\nSecond line", result.value());
        assertEquals(ConservativePromptNormalizer.VERSION, result.normalizationVersion());
    }

    @Test
    void normalizationPreservesTechnicalContent() {
        String content = "Use  MyClass.equals(value); and keep CASE\n"
                + "~~~java\nString value = \"a  b\";\n~~~";

        assertEquals(content, normalizer.normalize(new Prompt(content)).value());
    }

    @Test
    void hashUsesExpectedUtf8Sha256Value() {
        PromptHash result = hasher.hash(new NormalizedPrompt("Hello\nWorld", 1));

        assertEquals("c1c47f820aee8a66ebd5132187c12538411a2a31818b4e1c0526e76045c61e37", result.value());
        assertEquals(1, result.normalizationVersion());
    }

    @Test
    void hashIncludesNormalizationVersion() {
        PromptHash versionOne = hasher.hash(new NormalizedPrompt("same text", 1));
        PromptHash versionTwo = hasher.hash(new NormalizedPrompt("same text", 2));

        assertNotEquals(versionOne.value(), versionTwo.value());
    }

    @Test
    void normalizedPromptRejectsCarriageReturn() {
        assertThrows(IllegalArgumentException.class,
                () -> new NormalizedPrompt("first\rsecond", 1));
    }

    @Test
    void hashModelsRejectInvalidFormatAndVersions() {
        assertThrows(IllegalArgumentException.class,
                () -> new NormalizedPrompt("content", 0));
        assertThrows(IllegalArgumentException.class,
                () -> new PromptHash("not-a-sha-256", 1));
        assertThrows(IllegalArgumentException.class,
                () -> new PromptHash("a".repeat(64), 0));
    }
}
