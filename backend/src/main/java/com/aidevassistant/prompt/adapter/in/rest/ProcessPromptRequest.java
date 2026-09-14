package com.aidevassistant.prompt.adapter.in.rest;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record ProcessPromptRequest(
        @NotBlank @Size(max = 20_000) String prompt,
        @Valid ProjectContextInput projectContext) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ProjectContextInput(
            @Size(max = 50) List<@Valid TechnologyInput> languages,
            @Size(max = 50) List<@Valid TechnologyInput> frameworks,
            @Size(max = 100) String buildTool) {

        public ProjectContextInput {
            languages = languages == null ? List.of() : List.copyOf(languages);
            frameworks = frameworks == null ? List.of() : List.copyOf(frameworks);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TechnologyInput(
            @NotBlank @Size(max = 100) String name,
            @Size(max = 100) String version) {
    }
}
