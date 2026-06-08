import { Fragment, useEffect, useState } from "react";
import { useParams, useLocation, Redirect } from "react-router-dom";
import { useSelector } from "react-redux";
import { FormattedMessage, useIntl } from "react-intl";
import { Helmet } from "react-helmet-async";

import { Button } from "../../components/button";
import { Header, Main } from "../../components/page";
import { NumberInput } from "../../components/number-input";
import { getRandomId } from "../../utils/id";
import { rankAfter } from "../../utils/list-ordering";
import { addListOp } from "../../utils/owr-list";
import { useListCommit } from "../../utils/owr-list-commit";

import "./DuplicateList.css";

export const DuplicateList = ({ isMobile }) => {
  const location = useLocation();
  const intl = useIntl();
  const MainComponent = isMobile ? Main : Fragment;
  const { listId } = useParams();
  const commit = useListCommit();
  const [name, setName] = useState("");
  const [points, setPoints] = useState(2000);
  const [description, setDescription] = useState("");
  const [redirect, setRedirect] = useState(null);
  const list = useSelector((state) =>
    state.lists.find(({ id }) => listId === id),
  );

  const handlePointsChange = (event) => {
    setPoints(event.target.value);
  };
  const handleNameChange = (event) => {
    setName(event.target.value);
  };
  const handleDescriptionChange = (event) => {
    setDescription(event.target.value);
  };
  const handleSubmit = (event) => {
    event.preventDefault();
    const newId = getRandomId();
    commit((storedLists) => {
      const source = storedLists.find((l) => l.id === listId);
      const duplicate = {
        ...list,
        name,
        points,
        description,
        id: newId,
        folder: source?.folder ?? null,
        rank: rankAfter(
          storedLists.filter((l) => !l._deleted),
          source,
        ),
      };
      return addListOp(duplicate)(storedLists);
    });

    setRedirect(newId);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (list) {
      setName(
        `${intl.formatMessage({
          id: "duplicate.copyOf",
        })} ${list?.name}`,
      );
      setPoints(list.points);
      setDescription(list.description);
    }
  }, [list, intl]);

  if (!list) {
    return (
      <>
        <Header
          to={`/editor/${listId}`}
          headline={intl.formatMessage({
            id: "duplicate.title",
          })}
        />
        <Main />
      </>
    );
  }

  return (
    <>
      {redirect && <Redirect to={`/editor/${redirect}`} />}

      <Helmet>
        <title>{`Old World Builder | ${list?.name}`}</title>
      </Helmet>

      {isMobile && (
        <Header
          to={`/editor/${listId}`}
          headline={intl.formatMessage({
            id: "duplicate.title",
          })}
        />
      )}

      <MainComponent>
        {!isMobile && (
          <Header
            isSection
            to={`/editor/${listId}`}
            headline={intl.formatMessage({
              id: "duplicate.title",
            })}
          />
        )}
        <form onSubmit={handleSubmit} className="duplicate">
          <label htmlFor="name">
            <FormattedMessage id="misc.name" />
          </label>
          <input
            type="text"
            id="name"
            className="input"
            value={name}
            onChange={handleNameChange}
            autoComplete="off"
            required
            maxLength="100"
          />
          <label htmlFor="description" className="edit__label">
            <FormattedMessage id="misc.description" />
          </label>
          <input
            type="text"
            id="description"
            className="input"
            value={description}
            onChange={handleDescriptionChange}
            autoComplete="off"
            maxLength="255"
          />
          <label htmlFor="points">
            <FormattedMessage id="misc.points" />
          </label>
          <NumberInput
            id="points"
            min={0}
            value={points}
            onChange={handlePointsChange}
            required
            interval={50}
          />
          <Button centered icon="duplicate" submitButton size="large">
            <FormattedMessage id="misc.duplicate" />
          </Button>
        </form>
      </MainComponent>
    </>
  );
};
