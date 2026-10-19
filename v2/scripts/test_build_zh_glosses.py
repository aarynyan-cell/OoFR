"""Reading the local AI's answers back (build_zh_glosses.py). No model or Kaikki file needed.

Run from the repository root:
  python3 -m unittest discover -s v2/scripts -p "test_*.py"
"""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("glosses", Path(__file__).with_name("build_zh_glosses.py"))
glosses = importlib.util.module_from_spec(spec)
spec.loader.exec_module(glosses)


def word(name, *groups):
    return {"word": name, "groups": [{"pos": pos, "gender": gender, "senses": ["x"] * count} for pos, gender, count in groups], "score": 0}


TOUR = word("tour", ("noun", "masculine", 4), ("noun", "feminine", 3))
RUE = word("rue", ("noun", "feminine", 2))
MORT = word("mort", ("adjective", "", 1), ("noun", "masculine", 1), ("noun", "feminine", 1))
SAUCE = word("sauce", ("noun", "feminine", 2))
VINGTAINE = word("vingtaine", ("noun", "feminine", 2))
TODAY = word("aujourd'hui", ("adverb", "", 2))
FAMILLE = word("famille", ("noun", "feminine", 2))


class ParseTest(unittest.TestCase):
    def test_expected_format(self):
        answer = "tour\nnoun (masculine): 轮次；周长\nnoun (feminine): 塔\n\nrue\nnoun: 街；路"
        self.assertEqual(glosses.parse(answer, [TOUR, RUE]), {
            "tour": [{"pos": "noun", "gender": "masculine", "zh": ["轮次", "周长"]}, {"pos": "noun", "gender": "feminine", "zh": ["塔"]}],
            "rue": [{"pos": "noun", "gender": "feminine", "zh": ["街", "路"]}],
        })

    def test_gendered_chinese_labels(self):
        result = glosses.parse("tour\n名词（阴）：塔、公寓楼；名词（阳）：轮次、周长", [TOUR])
        self.assertEqual([(group["gender"], group["zh"]) for group in result["tour"]],
                         [("feminine", ["塔、公寓楼"]), ("masculine", ["轮次、周长"])])

    def test_plain_noun_lines_fill_noun_groups_in_order(self):
        result = glosses.parse("mort\nadjective: 死的\nnoun: 死者\nnoun: 死亡", [MORT])
        self.assertEqual([(group["pos"], group["gender"], group["zh"]) for group in result["mort"]],
                         [("adjective", "", ["死的"]), ("noun", "masculine", ["死者"]), ("noun", "feminine", ["死亡"])])

    def test_dictionary_abbreviations(self):
        result = glosses.parse("sauce\nn. 酱汁；调味汁\n\nvingtaine\nn. 二十左右", [SAUCE, VINGTAINE])
        self.assertEqual(result["sauce"][0]["zh"], ["酱汁", "调味汁"])
        self.assertEqual(result["vingtaine"][0]["zh"], ["二十左右"])

    def test_answer_without_word_lines_in_matching_order(self):
        result = glosses.parse("adverb: 今天、如今；\nnoun: 家庭；", [TODAY, FAMILLE])
        self.assertEqual(result["aujourd'hui"][0]["zh"], ["今天、如今"])
        self.assertEqual(result["famille"][0]["zh"], ["家庭"])

    def test_answer_without_word_lines_never_shifts_meanings(self):
        # Two lines for three groups: which word each line belongs to is unknown.
        self.assertEqual(glosses.parse("noun: 家庭\nnoun: 街", [TODAY, FAMILLE, RUE]), {})
        # Parts of speech out of order: refused rather than guessed.
        self.assertEqual(glosses.parse("noun: 家庭\nadverb: 今天", [TODAY, FAMILLE]), {})

    def test_english_and_long_senses_are_dropped(self):
        result = glosses.parse("rue\nnoun: street；街；" + "很" * 30, [RUE])
        self.assertEqual(result["rue"][0]["zh"], ["街"])


class TidyTest(unittest.TestCase):
    def test_embedded_part_of_speech_moves_to_its_group(self):
        marin = [{"pos": "adjective", "gender": "", "senses": ["x"]}, {"pos": "noun", "gender": "masculine", "senses": ["x"]},
                 {"pos": "noun", "gender": "feminine", "senses": ["x"]}]
        result = glosses.tidy([{"pos": "adjective", "gender": "", "zh": ["海事的、海洋的", "名词（阳性）：水手", "名词（阴性）：海军"]}], marin)
        self.assertEqual([(group["pos"], group["gender"], group["zh"]) for group in result],
                         [("adjective", "", ["海事的、海洋的"]), ("noun", "masculine", ["水手"]), ("noun", "feminine", ["海军"])])

    def test_house_style(self):
        self.assertEqual(glosses.clean_sense("(口语)熬夜"), "熬夜（口语）")
        self.assertEqual(glosses.clean_sense("正典、正典、正典"), "正典")
        self.assertEqual(glosses.clean_sense("清淡的、无套的（见同义词表：无套）"), "清淡的、无套的")
        self.assertEqual(glosses.clean_sense("(m.) 田地（各种含义）"), "名词（阳性）：田地")
        self.assertEqual(glosses.clean_sense("n. (f.) 损坏、破坏"), "名词（阴性）：损坏、破坏")
        self.assertEqual(glosses.clean_sense("f. 政治学"), "名词（阴性）：政治学")
        self.assertEqual(glosses.clean_sense("（用于否定句中的语法宾语）"), "（用于否定句中的语法宾语）")

    def test_empty_senses_are_dropped(self):
        result = glosses.tidy([{"pos": "adjective", "gender": "", "zh": ["的", "（）", "粗俗的"]}])
        self.assertEqual(result[0]["zh"], ["粗俗的"])
        self.assertEqual(glosses.tidy([{"pos": "adjective", "gender": "", "zh": ["的"]}]), [])

    def test_abbreviated_gender_creates_the_right_group(self):
        barbe = [{"pos": "noun", "gender": "feminine", "senses": ["x"]}, {"pos": "noun", "gender": "masculine", "senses": ["x"]}]
        result = glosses.tidy([{"pos": "noun", "gender": "feminine", "zh": ["胡须", "n. 巴巴利马（阳性）"]}], barbe)
        self.assertEqual([(group["gender"], group["zh"]) for group in result], [("feminine", ["胡须"]), ("masculine", ["巴巴利马"])])


class CompletenessTest(unittest.TestCase):
    def test_missing_groups(self):
        record = {"groups": [{"pos": "adjective", "gender": "", "zh": ["死的"]}]}
        self.assertEqual([(group["pos"], group["gender"]) for group in glosses.missing_groups(record, MORT)],
                         [("noun", "masculine"), ("noun", "feminine")])


if __name__ == "__main__":
    unittest.main()
