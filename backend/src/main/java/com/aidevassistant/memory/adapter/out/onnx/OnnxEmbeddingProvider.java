package com.aidevassistant.memory.adapter.out.onnx;

import ai.djl.huggingface.tokenizers.Encoding;
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import com.aidevassistant.memory.application.port.out.EmbeddingProvider;
import com.aidevassistant.memory.domain.model.Embedding;
import com.aidevassistant.prompt.domain.model.NormalizedPrompt;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

final class OnnxEmbeddingProvider implements EmbeddingProvider, AutoCloseable {

    private static final String INPUT_IDS = "input_ids";
    private static final String ATTENTION_MASK = "attention_mask";
    private static final String TOKEN_TYPE_IDS = "token_type_ids";
    private static final String DJL_OFFLINE_PROPERTY = "ai.djl.offline";

    private final OnnxEmbeddingModel model;
    private final OrtEnvironment environment;
    private final OrtSession session;
    private final HuggingFaceTokenizer tokenizer;
    private boolean closed;

    OnnxEmbeddingProvider(OnnxEmbeddingModel model) {
        System.setProperty(DJL_OFFLINE_PROPERTY, "true");
        this.model = Objects.requireNonNull(model, "Embedding model must not be null");
        validateArtifact(model.modelPath(), model.modelSha256());
        validateArtifact(model.tokenizerPath(), model.tokenizerSha256());

        environment = OrtEnvironment.getEnvironment();
        HuggingFaceTokenizer loadedTokenizer = null;
        OrtSession loadedSession = null;
        try {
            loadedTokenizer = HuggingFaceTokenizer.builder()
                    .optTokenizerPath(model.tokenizerPath())
                    .optAddSpecialTokens(true)
                    .optTruncation(true)
                    .optMaxLength(model.maxTokens())
                    .build();
            try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
                options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
                loadedSession = environment.createSession(model.modelPath().toString(), options);
            }
            validateInputs(loadedSession.getInputNames());
        } catch (IOException | OrtException exception) {
            closeAfterFailedInitialization(loadedSession, loadedTokenizer);
            throw new EmbeddingModelException("Could not initialize the local ONNX embedding model", exception);
        } catch (RuntimeException exception) {
            closeAfterFailedInitialization(loadedSession, loadedTokenizer);
            throw exception;
        }
        tokenizer = loadedTokenizer;
        session = loadedSession;
    }

    @Override
    public synchronized Embedding generate(NormalizedPrompt prompt) {
        Objects.requireNonNull(prompt, "Normalized prompt must not be null");
        if (closed) {
            throw new EmbeddingModelException("The local ONNX embedding model is closed");
        }

        Encoding encoding = tokenizer.encode(model.textPrefix() + prompt.value());
        long[] inputIds = encoding.getIds();
        long[] attentionMask = encoding.getAttentionMask();
        long[] tokenTypeIds = encoding.getTypeIds();
        Map<String, OnnxTensor> inputs = new HashMap<>();

        try {
            inputs.put(INPUT_IDS, tensor(inputIds));
            inputs.put(ATTENTION_MASK, tensor(attentionMask));
            if (session.getInputNames().contains(TOKEN_TYPE_IDS)) {
                inputs.put(TOKEN_TYPE_IDS, tensor(tokenTypeIds));
            }

            try (OrtSession.Result result = session.run(Map.copyOf(inputs))) {
                float[] values = meanPool(firstTokenEmbeddingOutput(result), attentionMask);
                if (values.length != model.dimension()) {
                    throw new EmbeddingModelException(
                            "Unexpected embedding dimension: " + values.length
                                    + ", expected: " + model.dimension());
                }
                normalize(values);
                return new Embedding(model.modelId(), model.modelVersion(), values);
            }
        } catch (OrtException exception) {
            throw new EmbeddingModelException("Local ONNX embedding inference failed", exception);
        } finally {
            inputs.values().forEach(OnnxTensor::close);
        }
    }

    @Override
    public synchronized void close() {
        if (!closed) {
            try {
                session.close();
            } catch (OrtException exception) {
                throw new EmbeddingModelException("Could not close the local ONNX embedding model", exception);
            } finally {
                tokenizer.close();
                closed = true;
            }
        }
    }

    private OnnxTensor tensor(long[] values) throws OrtException {
        return OnnxTensor.createTensor(environment, new long[][]{values});
    }

    private float[][][] firstTokenEmbeddingOutput(OrtSession.Result result) throws OrtException {
        for (Map.Entry<String, OnnxValue> output : result) {
            Object value = output.getValue().getValue();
            if (value instanceof float[][][] tokenEmbeddings) {
                return tokenEmbeddings;
            }
        }
        throw new EmbeddingModelException("The ONNX model did not return token embeddings");
    }

    private float[] meanPool(float[][][] batch, long[] attentionMask) {
        if (batch.length != 1 || batch[0].length != attentionMask.length) {
            throw new EmbeddingModelException("Unexpected ONNX token embedding shape");
        }

        float[] pooled = new float[batch[0][0].length];
        long includedTokens = 0;
        for (int token = 0; token < attentionMask.length; token++) {
            if (attentionMask[token] == 0) {
                continue;
            }
            includedTokens++;
            for (int dimension = 0; dimension < pooled.length; dimension++) {
                pooled[dimension] += batch[0][token][dimension];
            }
        }
        if (includedTokens == 0) {
            throw new EmbeddingModelException("Tokenizer produced no usable tokens");
        }
        for (int dimension = 0; dimension < pooled.length; dimension++) {
            pooled[dimension] /= includedTokens;
        }
        return pooled;
    }

    private void normalize(float[] values) {
        double squaredNorm = 0;
        for (float value : values) {
            squaredNorm += value * value;
        }
        double norm = Math.sqrt(squaredNorm);
        if (norm == 0 || !Double.isFinite(norm)) {
            throw new EmbeddingModelException("ONNX model produced an invalid embedding norm");
        }
        for (int index = 0; index < values.length; index++) {
            values[index] = (float) (values[index] / norm);
        }
    }

    private void validateInputs(Set<String> inputNames) {
        if (!inputNames.contains(INPUT_IDS) || !inputNames.contains(ATTENTION_MASK)) {
            throw new EmbeddingModelException(
                    "ONNX model must accept input_ids and attention_mask");
        }
    }

    private void validateArtifact(Path path, String expectedChecksum) {
        if (!Files.isRegularFile(path)) {
            throw new EmbeddingModelException("Required local embedding artifact not found: " + path);
        }
        String actualChecksum = sha256(path);
        if (!MessageDigest.isEqual(
                expectedChecksum.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                actualChecksum.getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
            throw new EmbeddingModelException("Checksum mismatch for local embedding artifact: " + path);
        }
    }

    private String sha256(Path path) {
        try (InputStream input = Files.newInputStream(path)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException | NoSuchAlgorithmException exception) {
            throw new EmbeddingModelException("Could not verify local embedding artifact: " + path, exception);
        }
    }

    private void closeAfterFailedInitialization(
            OrtSession loadedSession,
            HuggingFaceTokenizer loadedTokenizer) {
        if (loadedSession != null) {
            try {
                loadedSession.close();
            } catch (OrtException ignored) {
                // The initialization exception remains the primary failure.
            }
        }
        if (loadedTokenizer != null) {
            loadedTokenizer.close();
        }
    }
}
