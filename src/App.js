import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

import { NewList } from "./pages/new-list";
import { Editor } from "./pages/editor";
import { Home } from "./pages/home";
import { Unit } from "./pages/unit";
import { Edit } from "./pages/edit";
import { setLists } from "./state/lists";

import "./App.css";

export const App = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    const localLists = localStorage.getItem("lists");

    dispatch(setLists(JSON.parse(localLists)));
  }, [dispatch]);

  return (
    <Router>
      <Switch>
        <Route path="/editor/:listId/edit">{<Edit />}</Route>
        <Route path="/editor/:listId/add/:type">{<Unit />}</Route>
        <Route path="/editor/:listId/:type/:unitId">{<Unit />}</Route>
        <Route path="/editor/:listId">{<Editor />}</Route>
        <Route path="/new">{<NewList />}</Route>
        <Route path="/">{<Home />}</Route>
      </Switch>
    </Router>
  );
};
