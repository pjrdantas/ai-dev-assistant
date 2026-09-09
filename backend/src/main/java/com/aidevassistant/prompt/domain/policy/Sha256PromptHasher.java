package com.aidevassistant.prompt.domain.policy;

import com.aidevassistant.prompt.domain.model.NormalizedPrompt;
import com.aidevassistant.prompt.domain.model.PromptHash;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;

public final class Sha256PromptHasher {

    public PromptHash hash(NormalizedPrompt prompt) {
        Objects.requireNonNull(prompt, "Normalized prompt must not be null");

        String hashInput = "v" + prompt.normalizationVersion() + "\n" + prompt.value();
        byte[] digest = messageDigest().digest(hashInput.getBytes(StandardCharsets.UTF_8));

        return new PromptHash(HexFormat.of().formatHex(digest), prompt.normalizationVersion());
    }

    private MessageDigest messageDigest() {
        try {
            return MessageDigest.getInstance(PromptHash.ALGORITHM);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }
}
