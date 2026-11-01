# Whisper base, 8-bit ONNX copy for MulTape

Model: OpenAI Whisper base (https://github.com/openai/whisper), code and weights under the MIT License (`LICENSE`).

ONNX conversion with 8-bit weights: onnx-community/whisper-base (Transformers.js), revision 1846881b6b3a3024392c1eea3ad983695bc23925
(https://huggingface.co/onnx-community/whisper-base/tree/1846881b6b3a3024392c1eea3ad983695bc23925). Files renamed only:
`onnx/encoder_model_quantized.onnx` → `encoder.int8.onnx`, `onnx/decoder_model_merged_quantized.onnx` → `decoder.int8.onnx`; `vocab.json` unchanged.
